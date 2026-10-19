import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { eventMillis } from '../src/comments.js';

/**
 * Возврат комментариям их настоящей даты.
 *
 * Instagram присылает entry.time в секундах, а Date ждёт
 * миллисекунды. Код это уже умеет, но правка не чинит записанного до
 * неё: комментарий стоял в ленте 21 января 1970 года, а его диалог —
 * в самом низу списка, потому что список сортируется по дате
 * последнего сообщения.
 *
 * Здесь проверяется то, на чём стоит миграция: ошибка обратима ровно,
 * а не приблизительно.
 */
const SQL = readFileSync(
  new URL('../../../infra/postgres/migrations/054-comment-time-repair.sql', import.meta.url),
  'utf8',
);

/** Что делала старая строка кода: секунды принимались за миллисекунды. */
function asWritten(seconds: number): Date {
  return new Date(seconds);
}

/** Что делает миграция: умножает эпоху записанного на тысячу. */
function asRepaired(stored: Date): Date {
  return new Date((stored.getTime() / 1000) * 1000 * 1000);
}

describe('ошибка обратима', () => {
  it('умножение на тысячу возвращает исходную секунду', () => {
    // Комментарий со скриншота: 21 января 1970, 17:47 UTC.
    const broken = new Date(Date.UTC(1970, 0, 21, 17, 47, 0));
    const back = asRepaired(broken);
    expect(back.toISOString().slice(0, 10)).toBe('2026-10-14');
  });

  it('и так для любой секунды, а не только для этой', () => {
    for (const iso of ['2026-10-14T23:20:00Z', '2025-01-01T00:00:00Z', '2026-05-05T12:34:56Z']) {
      const real = Math.floor(new Date(iso).getTime() / 1000);
      expect(asRepaired(asWritten(real)).toISOString()).toBe(
        new Date(real * 1000).toISOString(),
      );
    }
  });

  /* Тот же разбор, уже исправленный: новые комментарии в починке не
     нуждаются, и миграция их не найдёт. */
  it('новые комментарии в 1970-й уже не попадают', () => {
    const seconds = Math.floor(Date.UTC(2026, 9, 14, 23, 20) / 1000);
    expect(new Date(eventMillis(seconds)!).getUTCFullYear()).toBe(2026);
  });
});

describe('что миграция трогает', () => {
  it('только каналы комментариев', () => {
    expect(SQL).toContain("ch.type IN ('instagram_comments', 'messenger_comments')");
  });

  /* Настоящий комментарий из 1970 года невозможен — по этому признаку
     сломанные и отличаются от целых. */
  it('только то, что лежит в 1970-м', () => {
    expect(SQL).toContain("m2.sent_at < timestamptz '1971-06-01'");
  });

  /* Неверная дата лучше выдуманной: если после умножения вышло не
     похожее на правду время, строку не трогаем вовсе. */
  it('и только если получилось похожее на правду время', () => {
    expect(SQL).toContain("f.fixed >= timestamptz '2024-01-01'");
    expect(SQL).toContain("f.fixed <= now() + interval '1 day'");
  });

  /* Дата последнего сообщения ведёт список чатов. Починить сообщения,
     не тронув её, значит оставить диалог внизу с верными датами
     внутри. */
  it('заодно чинит дату последнего сообщения в диалоге', () => {
    expect(SQL).toContain('UPDATE conversations c');
    expect(SQL).toContain("c.last_message_at < timestamptz '1971-06-01'");
  });

  /* У диалога сообщений может быть несколько, и верная дата — это
     дата последнего, какой бы она ни была. */
  it('дату диалога пересчитывает из сообщений, а не умножает', () => {
    expect(SQL).toContain('max(sent_at) AS at');
    expect(SQL).not.toContain('extract(epoch FROM c.last_message_at)');
  });
});
