/**
 * Курс НБУ на дату.
 *
 * Жил в панели владельца, пока счета выставлял только он. Теперь счёт
 * может выставить себе и клиент, а курс в двух местах — это два разных
 * курса в одном и том же счёте, стоит одному месту однажды сходить в
 * НБУ, а второму взять своё, кэшированное.
 *
 * Сначала смотрим свой справочник: курс за прошедший день больше не
 * меняется, и ходить за ним в чужой сервис на каждое открытие формы
 * незачем. Отказ возвращается значением, а не ошибкой: НБУ может
 * молчать, а счёт выставить надо — тогда курс вписывают руками.
 */

import { nbuRate, withSystem, type Pool } from '@omnidesk/core';

export interface RateHit {
  rate: number;
  day: string;
  source: 'nbu' | 'cache';
}

export type RateFor = (code: string, day: string) => Promise<RateHit | null>;

export function makeRateFor(pool: Pool, fetchImpl?: typeof fetch): RateFor {
  return async function rateFor(code, day) {
    if (code === 'UAH') return { rate: 1, day, source: 'nbu' };

    const cached = await withSystem(pool, 'курс из справочника', async (db) => {
      const { rows } = await db.query<{ rate: string; day: string }>(
        `SELECT rate, to_char(day, 'YYYY-MM-DD') AS day
           FROM nbu_rates WHERE code = $1 AND day <= $2::date
          ORDER BY day DESC LIMIT 1`,
        [code, day],
      );
      return rows[0] ?? null;
    });
    // Курс из справочника годится, только если он за сам этот день:
    // более ранний мог быть последним известным, а мог просто значить,
    // что за свежие дни мы ещё не спрашивали.
    if (cached && cached.day === day) {
      return { rate: Number(cached.rate), day: cached.day, source: 'cache' };
    }

    const got = await nbuRate(code, day, fetchImpl ? { fetchImpl } : {});
    if (!got) return cached ? { rate: Number(cached.rate), day: cached.day, source: 'cache' } : null;

    await withSystem(pool, 'запись курса', async (db) => {
      await db.query(
        `INSERT INTO nbu_rates (day, code, rate) VALUES ($1::date, $2, $3)
         ON CONFLICT (day, code) DO UPDATE SET rate = EXCLUDED.rate, fetched_at = now()`,
        [got.day, code, got.rate],
      );
    });
    return { ...got, source: 'nbu' };
  };
}
