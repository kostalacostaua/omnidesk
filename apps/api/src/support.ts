/**
 * Поддержка в кабинете — на нашем же продукте.
 *
 * Клиенту нужно уметь написать нам оттуда, где он работает, а не искать
 * почту на сайте. Отдельную переписку для этого заводить не из чего: у
 * нас уже есть чат на сайте, и наша собственная поддержка сидит в той
 * же скриньке, что и поддержка любого клиента. Поэтому окно в кабинете
 * — это наш webchat, и письма из него приходят нам в Rozmovio.
 *
 * Здесь только две вещи, которых публичному чату не хватает.
 *
 * Первая: постоянство переписки. Посетителю сайта идентификатор выдают
 * случайным и держат в его браузере — сменил браузер, начал заново. Для
 * клиента это неверно: он пишет нам полгода, и вся история должна быть
 * одной ниткой. Поэтому идентификатор считается из номера пользователя
 * подписью на нашем секрете: он всегда один и тот же, подобрать его
 * снаружи нечем, а хранить его отдельной колонкой не нужно.
 *
 * Вторая: имя. Посетитель сайта безымянен, и это нормально. Обращение
 * клиента безымянным быть не должно — иначе поддержка отвечает «добрий
 * день» человеку, про которого мы знаем и имя, и компанию, и тариф.
 * Имя собирается на сервере из базы, а не приходит из браузера.
 *
 * Ключ канала берётся из окружения и по умолчанию тот же, что у чата на
 * сайте: своя поддержка и поддержка сайта — это одни и те же люди в
 * одной и той же скриньке.
 */

import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { withSystem, type Pool } from '@omnidesk/core';

export interface SupportDeps {
  pool: Pool;
  requireAuth: (req: unknown) => { userId: string; tenantId: string } | null;
  /** Публичный ключ канала webchat, в который приходят обращения. */
  siteKey: string;
  /** Секрет, на котором подписывается идентификатор переписки. */
  secret: string;
}

/**
 * Идентификатор переписки клиента с нами.
 *
 * Считается, а не хранится: колонка означала бы миграцию, значение,
 * которое можно потерять, и вопрос «а что если она пустая». Подпись
 * на секрете сервера даёт то же самое — постоянное значение, которое
 * нельзя подобрать, зная номер пользователя.
 *
 * Тридцать два знака — ровно то, что чат на сайте считает своим
 * идентификатором посетителя; ни короче, ни длиннее он не примет.
 */
export function supportVisitor(secret: string, userId: string): string {
  return createHmac('sha256', secret || 'support')
    .update(`support:${userId}`)
    .digest('hex')
    .slice(0, 32);
}

/** Ключ канала на вид. Опечатка в переменной не должна уезжать в браузер. */
export function supportKeyOk(key: string): boolean {
  return /^wc[a-z0-9]{6,60}$/.test(String(key ?? '').trim());
}

/**
 * Как нас подписать в нашей же скриньке.
 *
 * «Костя, Ромашка» — этого достаточно, чтобы узнать человека в списке
 * диалогов. Почта и тариф видны в карточке, дублировать их в имени
 * незачем: длинное имя в списке обрезается, и обрезается оно как раз
 * по тому, что нужнее.
 */
export function supportName(user: string | null, company: string | null): string {
  const who = String(user ?? '').trim();
  const where = String(company ?? '').trim();
  if (who && where) return `${who}, ${where}`.slice(0, 80);
  return (who || where || 'Клієнт').slice(0, 80);
}

export function registerSupport(app: FastifyInstance, deps: SupportDeps): void {
  /**
   * Всё, что нужно окну поддержки.
   *
   * Одним ответом, потому что окно открывается одним нажатием: ключ
   * канала, постоянный идентификатор переписки и подпись. Дальше
   * браузер разговаривает с публичными ручками чата напрямую — теми
   * самыми, которыми пользуется чат на чужом сайте, и никакой второй
   * реализации переписки у нас не появляется.
   *
   * Ручка доступна и при закрытом доступе: человек, которому нечем
   * пользоваться, — первый, кому надо нам написать.
   */
  app.get('/support', async (req, reply) => {
    const auth = deps.requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });

    const key = String(deps.siteKey ?? '').trim();
    if (!supportKeyOk(key)) return { ready: false };

    const who = await withSystem(deps.pool, 'подпись обращения в поддержку', async (db) => {
      const { rows } = await db.query<{ full_name: string | null; company: string | null }>(
        `SELECT u.full_name, t.name AS company
           FROM users u JOIN tenants t ON t.id = u.tenant_id
          WHERE u.id = $1 LIMIT 1`,
        [auth.userId],
      );
      return rows[0] ?? null;
    });

    return {
      ready: true,
      key,
      visitorId: supportVisitor(deps.secret, auth.userId),
      name: supportName(who?.full_name ?? null, who?.company ?? null),
    };
  });
}
