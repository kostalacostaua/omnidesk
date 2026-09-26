import type { FastifyInstance, FastifyReply } from 'fastify';
import { randomBytes } from 'node:crypto';
import {
  BITRIX_SCOPES,
  CrmError,
  bitrixBindWidgets,
  bitrixHost,
  bitrixLink,
  bitrixWhoAmI,
  decryptJson,
  encryptJson,
  placementModule,
  placementRecord,
  readHandshake,
  withSystem,
  withTenant,
  type BitrixCreds,
  type Pool,
} from '@omnidesk/core';

/**
 * Локальное приложение Битрикс24.
 *
 * Зачем оно, если вебхук уже работает: виджет в карточке клиента
 * ставится методом placement.bind, а на него Битрикс отвечает вебхуку
 * отказом — «нужен контекст приложения». Переписка в карточке и есть
 * то, ради чего к CRM подключаются, поэтому подключение выросло из
 * одного поля в приложение.
 *
 * Вебхук никуда не делся: у кого он настроен, тот продолжает работать
 * и ничего не переделывает. Разница только в том, что виджета у него
 * нет и не будет.
 *
 * Адрес обработчика свой у каждой компании: Битрикс в своём запросе не
 * говорит, чей он, — в нём есть опознаватель портала, а не наш номер
 * компании. Ключ в адресе и есть то, по чему мы узнаём, к кому пришли.
 */

const auth401 = { error: 'unauthorized' };

export interface BitrixDeps {
  pool: Pool;
  masterKey: Buffer;
  requireAuth: (req: unknown) => { tenantId: string; userId: string } | null;
  /** Наш внешний адрес: из него собирается путь обработчика. */
  appUrl: string;
  log: (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void;
}

interface ConnRow {
  id: string;
  title: string;
  creds_enc: Buffer;
  status: string;
  last_error: string | null;
}

/** Страница, которой Битрикс заканчивает установку. */
function finishPage(text: string, ok: boolean): string {
  return `<!doctype html><html lang="uk"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rozmovio</title>
<script src="//api.bitrix24.com/api/v1/"></script>
<style>
body{margin:0;font:15px/1.6 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;
  color:#111;background:#fff;padding:28px;text-align:center}
.t{font-size:18px;font-weight:600;margin-bottom:8px}
.s{color:#667085;max-width:36em;margin:0 auto}
.b{color:${ok ? '#17864f' : '#b4690e'}}
</style></head><body>
<div class="t b">${ok ? 'Rozmovio підключено' : 'Не вдалося підключити'}</div>
<div class="s">${text}</div>
<script>
/*
 * Пока приложение не сказало «я установилось», Битрикс считает его
 * недоустановленным: виджеты не появляются, даже если привязка прошла.
 */
try { BX24.init(function(){ try { BX24.installFinish() } catch (e) {} }) } catch (e) {}
</script>
</body></html>`;
}

export function registerBitrix(app: FastifyInstance, deps: BitrixDeps): void {
  const { pool, masterKey, requireAuth, log } = deps;

  const handlerUrl = (key: string): string =>
    `${(deps.appUrl || '').replace(/\/+$/, '')}/webhooks/bitrix/${key}`;

  /** Подключение Битрикса этой компании, если оно есть. */
  async function connOf(tenantId: string): Promise<ConnRow | null> {
    return withTenant(pool, tenantId, async (db) => {
      const { rows } = await db.query<ConnRow>(
        `SELECT id, title, creds_enc, status, last_error
           FROM crm_connections WHERE kind = 'bitrix24' LIMIT 1`,
      );
      return rows[0] ?? null;
    });
  }

  /**
   * Ключ установки.
   *
   * Заводится, когда человек впервые открыл страницу Битрикса: адрес
   * обработчика нужен ему до того, как появится сам портал, — он
   * вписывает этот адрес в карточку приложения у себя.
   */
  async function installKey(tenantId: string): Promise<string> {
    const found = await withSystem(pool, 'ключ установки Битрикса', async (db) => {
      const { rows } = await db.query<{ install_key: string }>(
        `SELECT install_key FROM bitrix_portals WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`,
        [tenantId],
      );
      return rows[0]?.install_key ?? null;
    });
    if (found) return found;

    const key = randomBytes(18).toString('base64url');
    await withSystem(pool, 'ключ установки Битрикса', async (db) => {
      await db.query(`INSERT INTO bitrix_portals (install_key, tenant_id) VALUES ($1, $2)`, [
        key,
        tenantId,
      ]);
    });
    return key;
  }

  /* ── Кабинет ─────────────────────────────────────────────────── */

  app.get('/settings/crm/bitrix', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);

    const [key, row] = await Promise.all([installKey(a.tenantId), connOf(a.tenantId)]);
    const creds = row ? decryptJson<BitrixCreds>(masterKey, a.tenantId, row.creds_enc) : null;

    return {
      handler: handlerUrl(key),
      scopes: BITRIX_SCOPES,
      /** Ключи приложения сохранены — осталось открыть его в Битриксе. */
      appSaved: Boolean(creds?.app?.clientId),
      installed: Boolean(creds?.oauth),
      webhook: Boolean(creds?.webhook && !creds?.oauth),
      portal: row?.title ?? '',
      status: row?.status ?? '',
      lastError: row?.last_error ?? null,
      connectionId: row?.id ?? null,
    };
  });

  /**
   * Ключи локального приложения.
   *
   * Их два и они разные: код приложения виден в карточке всегда, ключ
   * — только там же и только у владельца портала. Мы их не показываем
   * обратно никогда: в ответе есть лишь признак «сохранено».
   */
  app.post<{ Body: { clientId?: string; clientSecret?: string } }>(
    '/settings/crm/bitrix/app',
    async (req, reply) => {
      const a = requireAuth(req);
      if (!a) return reply.code(401).send(auth401);

      const clientId = (req.body?.clientId ?? '').trim();
      const clientSecret = (req.body?.clientSecret ?? '').trim();
      if (!/^[A-Za-z0-9._-]{8,128}$/.test(clientId) || !/^[A-Za-z0-9._-]{8,128}$/.test(clientSecret)) {
        return reply.code(400).send({
          error: 'bad_keys',
          detail: 'Скопіюйте код застосунку і ключ застосунку з картки застосунку в Бітріксі',
        });
      }

      const row = await connOf(a.tenantId);
      const prev = row ? decryptJson<BitrixCreds>(masterKey, a.tenantId, row.creds_enc) : {};
      // Токены не трогаем: ключи могут менять у уже установленного
      // приложения, и терять из-за этого доступ незачем.
      const next: BitrixCreds = { ...prev, app: { clientId, clientSecret } };

      await withTenant(pool, a.tenantId, async (db) => {
        await db.query(
          `INSERT INTO crm_connections (tenant_id, kind, title, creds_enc, created_by, status, last_error)
           VALUES ($1, 'bitrix24', $2, $3, $4, $5, $6)
           ON CONFLICT (tenant_id, kind) DO UPDATE SET creds_enc = EXCLUDED.creds_enc`,
          [
            a.tenantId,
            row?.title ?? '',
            encryptJson(masterKey, a.tenantId, next),
            a.userId,
            next.oauth ? 'active' : 'degraded',
            next.oauth ? null : 'Застосунок ще не відкривали в Бітріксі',
          ],
        );
      });

      const key = await installKey(a.tenantId);
      log('info', 'Ключи приложения Битрикса сохранены', { tenantId: a.tenantId });
      return { handler: handlerUrl(key) };
    },
  );

  /* ── Установка и открытие ────────────────────────────────────── */

  /**
   * Сюда Битрикс стучится сам.
   *
   * Не только при установке: то же самое он шлёт при каждом открытии
   * приложения. Поэтому обработчик идемпотентен — он всегда сохраняет
   * свежие токены и заново привязывает виджеты.
   *
   * Отвечаем страницей, а не кодом: человек в этот момент смотрит на
   * рамку внутри Битрикса, и пустой ответ он прочитает как поломку.
   */
  app.post<{ Params: { key: string } }>(
    '/webhooks/bitrix/:key',
    async (req, reply: FastifyReply) => {
      const html = (text: string, ok: boolean) =>
        reply
          .type('text/html; charset=utf-8')
          .header('cache-control', 'no-store')
          .send(finishPage(text, ok));

      const key = String(req.params.key ?? '');
      const owner = await withSystem(pool, 'портал Битрикса', async (db) => {
        const { rows } = await db.query<{ tenant_id: string; member_id: string | null }>(
          `SELECT tenant_id, member_id FROM bitrix_portals WHERE install_key = $1`,
          [key],
        );
        return rows[0] ?? null;
      });
      if (!owner) {
        log('warn', 'Битрикс постучался с чужим ключом установки', { ip: req.ip });
        return html('Це посилання більше не діє. Скопіюйте адресу обробника в кабінеті ще раз.', false);
      }

      let hand;
      try {
        hand = readHandshake(
          (req.query ?? {}) as Record<string, unknown>,
          (req.body ?? {}) as Record<string, unknown>,
        );
      } catch (err) {
        const why = err instanceof CrmError ? err.message : 'Битрикс прислал непонятный запрос';
        log('warn', 'Рукопожатие Битрикса не разобралось', { error: why });
        return html('Бітрікс надіслав запит без даних доступу. Спробуйте перевстановити застосунок.', false);
      }

      /*
       * Тот же портал в другой компании — это не «подключили ещё раз»,
       * а чужая переписка, которая поедет не туда. Отказываем, пока
       * прежняя сторона не отключит его у себя.
       */
      const taken = await withSystem(pool, 'портал Битрикса', async (db) => {
        const { rows } = await db.query<{ tenant_id: string }>(
          `SELECT tenant_id FROM bitrix_portals WHERE member_id = $1`,
          [hand.memberId],
        );
        return rows[0] ?? null;
      });
      if (taken && taken.tenant_id !== owner.tenant_id) {
        log('warn', 'Портал Битрикса уже подключён в другой компании', { memberId: hand.memberId });
        return html('Цей портал уже підключений в іншому акаунті Rozmovio.', false);
      }

      const row = await connOf(owner.tenant_id);
      const prev = row ? decryptJson<BitrixCreds>(masterKey, owner.tenant_id, row.creds_enc) : {};
      if (!prev.app?.clientId) {
        return html(
          'Спершу збережіть у Rozmovio код і ключ застосунку — без них доступ не оновити.',
          false,
        );
      }

      const creds: BitrixCreds = {
        ...prev,
        oauth: {
          accessToken: hand.accessToken,
          refreshToken: hand.refreshToken,
          expiresAt: hand.expiresAt,
          memberId: hand.memberId,
          domain: hand.domain,
        },
      };

      await withTenant(pool, owner.tenant_id, async (db) => {
        await db.query(
          `INSERT INTO crm_connections (tenant_id, kind, title, creds_enc, status, last_error)
           VALUES ($1, 'bitrix24', $2, $3, 'active', NULL)
           ON CONFLICT (tenant_id, kind) DO UPDATE SET
             title = EXCLUDED.title, creds_enc = EXCLUDED.creds_enc,
             status = 'active', last_error = NULL`,
          [owner.tenant_id, hand.domain, encryptJson(masterKey, owner.tenant_id, creds)],
        );
      });

      await withSystem(pool, 'портал Битрикса', async (db) => {
        await db.query(
          `UPDATE bitrix_portals SET member_id = $2, domain = $3, linked_at = now()
            WHERE install_key = $1`,
          [key, hand.memberId, hand.domain],
        );
      });

      // Виджеты ставим отсюда же: отдельной кнопкой «поставить виджет»
      // человек должен был бы вернуться к нам после установки, а он
      // уже стоит внутри Битрикса и считает дело сделанным.
      const saved = await connOf(owner.tenant_id);
      let widgets = 0;
      try {
        const link = await bitrixLink({
          pool,
          masterKey,
          tenantId: owner.tenant_id,
          rowId: saved?.id ?? '',
          creds,
        });
        widgets = await bitrixBindWidgets(link.call, widgetUrl(deps), 'Rozmovio');
      } catch (err) {
        log('warn', 'Виджеты Битрикса не поставились', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      log('info', 'Приложение Битрикса установлено', {
        tenantId: owner.tenant_id, domain: hand.domain, widgets,
      });

      return html(
        widgets > 0
          ? 'Готово. Вкладка Rozmovio зʼявиться в картках клієнтів, лідів і угод.'
          : 'Доступ отримано. Вкладку в картці поставити не вдалося — перевірте право placement у застосунку.',
        true,
      );
    },
  );

  /* ── Проверка связи ──────────────────────────────────────────── */

  app.post('/settings/crm/bitrix/check', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);

    const row = await connOf(a.tenantId);
    if (!row) return reply.code(404).send({ error: 'not_found' });

    const creds = decryptJson<BitrixCreds>(masterKey, a.tenantId, row.creds_enc);
    try {
      const link = await bitrixLink({
        pool, masterKey, tenantId: a.tenantId, rowId: row.id, creds,
      });
      const who = await bitrixWhoAmI(link.call);
      // Виджеты заодно: право placement могли выдать уже после
      // установки, и повторная привязка — единственный способ это
      // заметить, не заставляя переустанавливать приложение.
      if (link.asApp) await bitrixBindWidgets(link.call, widgetUrl(deps), 'Rozmovio');
      await withTenant(pool, a.tenantId, async (db) => {
        await db.query(
          `UPDATE crm_connections SET status = 'active', last_error = NULL WHERE id = $1`,
          [row.id],
        );
      });
      return { who };
    } catch (err) {
      const why = err instanceof CrmError ? err.message : 'Бітрікс не відповів';
      await withTenant(pool, a.tenantId, async (db) => {
        await db.query(
          `UPDATE crm_connections SET status = 'degraded', last_error = $2 WHERE id = $1`,
          [row.id, why],
        );
      });
      return reply.code(400).send({ error: 'check_failed', detail: why });
    }
  });
}

/** Адрес вкладки, которую Битрикс показывает внутри карточки. */
export function widgetUrl(deps: { appUrl: string }): string {
  return `${(deps.appUrl || '').replace(/\/+$/, '')}/widget/bitrix`;
}

/** Модуль карточки по коду места — нужен странице виджета. */
export { placementModule, placementRecord, bitrixHost };
