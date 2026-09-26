import type { FastifyInstance, FastifyReply } from 'fastify';
import { randomBytes } from 'node:crypto';
import {
  BITRIX_SCOPES,
  CrmError,
  bitrixAmount,
  bitrixOrderFields,
  bitrixOrderReady,
  bitrixPipelineFields,
  bitrixRows,
  orderItems,
  orderSubject,
  orderValues,
  parseBitrixOrder,
  type BitrixCall,
  type BitrixOrderSettings,
  type OrderField,
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
import { channelScope } from './scope.js';

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

/* ── Заказ из разговора ──────────────────────────────────────────
   У Битрикса заказ — это сделка в воронке. Воронок много, у каждой
   свои стадии и поля, а товаров может не быть вовсе: половина продаж
   — это сумма и пара полей. Поэтому настройка описывает чужую
   разметку, а выбирается всё из того, что вернул сам портал. */

interface Meta {
  at: number;
  pipelines: Array<{ id: string; name: string; stages: Array<{ id: string; name: string }> }>;
  fields: OrderField[];
}

/** Разметку портала держим минуту: она меняется руками и редко. */
const META_TTL = 60_000;

export function registerBitrixOrders(app: FastifyInstance, deps: BitrixOrderDeps): void {
  const { pool, masterKey, requireAuth } = deps;
  const metas = new Map<string, Meta>();

  async function linkOf(tenantId: string) {
    const row = await withTenant(pool, tenantId, async (db) => {
      const { rows } = await db.query<{ id: string; title: string; creds_enc: Buffer }>(
        `SELECT id, title, creds_enc FROM crm_connections WHERE kind = 'bitrix24' LIMIT 1`,
      );
      return rows[0] ?? null;
    });
    if (!row) return { error: 'bitrix_not_connected' } as const;

    const creds = decryptJson<BitrixCreds>(masterKey, tenantId, row.creds_enc);
    const link = await bitrixLink({ pool, masterKey, tenantId, rowId: row.id, creds });
    return { link, title: row.title };
  }

  /** Настройки заказа лежат там же, где остальные настройки CRM. */
  async function settingsOf(tenantId: string): Promise<BitrixOrderSettings> {
    const raw = await withSystem(pool, 'настройки заказа Битрикса', async (db) => {
      const { rows } = await db.query<{ v: unknown }>(
        `SELECT crm -> 'bitrixOrder' AS v FROM tenants WHERE id = $1`,
        [tenantId],
      );
      return rows[0]?.v ?? null;
    });
    return parseBitrixOrder(raw);
  }

  async function metaOf(tenantId: string, call: BitrixCall): Promise<Meta> {
    const fresh = metas.get(tenantId);
    if (fresh && Date.now() - fresh.at < META_TTL) return fresh;

    // entityTypeId 2 — сделка. Воронки сделок и есть то, что человек
    // называет воронками; у прочих сущностей они свои.
    const cats = (await call('crm.category.list', { entityTypeId: 2 })) as
      | { categories?: Array<{ id?: number | string; name?: string }> }
      | Array<{ id?: number | string; name?: string }>
      | null;
    const list = Array.isArray(cats) ? cats : (cats?.categories ?? []);

    const pipelines: Meta['pipelines'] = [];
    for (const c of list.slice(0, 40)) {
      const id = String(c?.id ?? '');
      if (!/^[0-9]{1,9}$/.test(id)) continue;
      /*
       * Стадии спрашиваем у общего списка состояний, а не у устаревшего
       * метода воронок: у общей воронки они зовутся NEW, у остальных —
       * C5:NEW, и собирать это имя самим значит однажды промахнуться.
       */
      const rows = (await call('crm.status.list', {
        filter: { ENTITY_ID: id === '0' ? 'DEAL_STAGE' : `DEAL_STAGE_${id}` },
        order: { SORT: 'ASC' },
      })) as Array<{ STATUS_ID?: string; NAME?: string }> | null;

      pipelines.push({
        id,
        name: String(c?.name ?? '') || `Воронка ${id}`,
        stages: (rows ?? [])
          .map((r) => ({ id: String(r?.STATUS_ID ?? ''), name: String(r?.NAME ?? '') }))
          .filter((s) => s.id),
      });
    }

    const fields = bitrixOrderFields(await call('crm.deal.fields', {}));
    const meta: Meta = { at: Date.now(), pipelines, fields };
    metas.set(tenantId, meta);
    return meta;
  }

  /** Что показать в настройках: воронки, стадии и поля сделки. */
  app.get('/crm/bitrix/order-meta', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);

    const got = await linkOf(a.tenantId);
    if ('error' in got) return reply.code(409).send(got);

    try {
      const meta = await metaOf(a.tenantId, got.link.call);
      return { pipelines: meta.pipelines, fields: meta.fields };
    } catch (err) {
      return reply.code(502).send(bitrixFail(err));
    }
  });

  app.get('/settings/orders/bitrix', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);
    return { settings: await settingsOf(a.tenantId) };
  });

  app.patch<{ Body: Record<string, unknown> }>('/settings/orders/bitrix', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);

    const next = parseBitrixOrder(req.body);
    /*
     * Пишем слиянием, а не заменой всего поля: рядом живут настройки
     * Zoho и «кого заводить», и перезапись целиком стёрла бы их —
     * молча и необратимо.
     */
    await withSystem(pool, 'настройки заказа Битрикса', async (db) => {
      await db.query(
        `UPDATE tenants
            SET crm = COALESCE(crm, '{}'::jsonb) || jsonb_build_object('bitrixOrder', $2::jsonb)
          WHERE id = $1`,
        [a.tenantId, JSON.stringify(next)],
      );
    });
    return { settings: next };
  });

  /**
   * Окно заказа, собранное для оператора.
   *
   * Здесь сходятся настройка и разметка: какие воронки ему открыты и
   * какие поля спрашивать в каждой. Считать это в браузере значило бы
   * отдать туда весь список полей сделки и правило «одинаковые поля» —
   * а оно обязано совпадать с тем, по которому потом проверяется заказ.
   */
  app.get('/crm/bitrix/order-form', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);

    const got = await linkOf(a.tenantId);
    if ('error' in got) return reply.code(409).send(got);

    const s = await settingsOf(a.tenantId);
    let meta: Meta;
    try {
      meta = await metaOf(a.tenantId, got.link.call);
    } catch (err) {
      return reply.code(502).send(bitrixFail(err));
    }

    const pick = (open: string[]) =>
      meta.fields.filter((f) => open.includes(f.api) || f.required);

    return {
      crm: 'bitrix24',
      ready: bitrixOrderReady(s),
      askAmount: s.askAmount,
      // Имена воронок берём из разметки, а не из сохранённой настройки:
      // воронку переименовали — оператор должен увидеть новое имя, а не
      // то, что записали полгода назад.
      pipelines: s.pipelines.map((p) => {
        const live = meta.pipelines.filter((x) => x.id === p.id)[0];
        return {
          id: p.id,
          name: live?.name || p.name || p.id,
          fields: pick(bitrixPipelineFields(s, p.id)),
        };
      }),
      fields: pick(s.fields),
    };
  });

  /**
   * Каталог.
   *
   * Большой каталог целиком не тянем: у Битрикса страница — пятьдесят
   * строк, и тысяча товаров означала бы двадцать запросов на каждое
   * открытие окна. Берём первые несколько страниц, а дальше ищем на
   * стороне портала — он умеет искать по части названия.
   */
  app.get<{ Querystring: { q?: string } }>('/crm/bitrix/products', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);

    const got = await linkOf(a.tenantId);
    if ('error' in got) return reply.code(409).send(got);

    const q = String(req.query?.q ?? '').trim().slice(0, 80);
    const items: Array<{ id: string; name: string; code: string; price: number; active: boolean }> = [];
    let truncated = false;

    try {
      const pages = q ? 1 : 4;
      for (let page = 0; page < pages; page += 1) {
        const rows = (await got.link.call('crm.product.list', {
          order: { NAME: 'ASC' },
          filter: { ACTIVE: 'Y', ...(q ? { '%NAME': q } : {}) },
          select: ['ID', 'NAME', 'PRICE', 'CURRENCY_ID'],
          start: page * 50,
        })) as Array<{ ID?: string | number; NAME?: string; PRICE?: string | number }> | null;

        const got50 = rows ?? [];
        for (const r of got50) {
          items.push({
            id: String(r?.ID ?? ''),
            name: String(r?.NAME ?? ''),
            code: '',
            price: Number(r?.PRICE ?? 0) || 0,
            active: true,
          });
        }
        if (got50.length < 50) break;
        if (page + 1 === pages) truncated = true;
      }
    } catch (err) {
      return reply.code(502).send(bitrixFail(err));
    }

    return { products: items, truncated, search: true };
  });

  /**
   * Заказ из разговора.
   *
   * Клиент может быть в Битриксе и контактом, и лидом: у сделки есть
   * место и под того, и под другого. Конвертировать лида ради заказа,
   * как это приходится делать в Zoho, здесь не нужно.
   *
   * Цены приходят с клиента, и это намеренно: оператор договаривается
   * о скидке в разговоре, и подставлять прайсовую цену поверх
   * договорённости значит делать заказ, который придётся переписывать
   * руками. Когда позиции есть, сумму считает Битрикс — своё умножение
   * здесь было бы вторым мнением о том, сколько клиент должен.
   */
  app.post<{
    Params: { id: string };
    Body: {
      subject?: string;
      pipeline?: string;
      amount?: string | number;
      fields?: Record<string, unknown>;
      items?: Array<{ productId?: string; quantity?: number; price?: number; discount?: string }>;
    };
  }>('/conversations/:id/bitrix-order', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);

    const conv = await withTenant(pool, a.tenantId, async (db) => {
      const { rows } = await db.query<{
        crm_kind: string | null;
        crm_module: string | null;
        crm_record_id: string | null;
        display_name: string | null;
      }>(
        `SELECT ct.crm_kind, ct.crm_module, ct.crm_record_id, ct.display_name
           FROM conversations c JOIN contacts ct ON ct.id = c.contact_id
          WHERE c.id = $1 AND ${channelScope('c.channel_id', '$2')}`,
        [req.params.id, a.userId],
      );
      return rows[0] ?? null;
    });
    if (!conv) return reply.code(404).send({ error: 'not_found' });
    if (!conv.crm_record_id) return reply.code(409).send({ error: 'not_linked' });

    const got = await linkOf(a.tenantId);
    if ('error' in got) return reply.code(409).send(got);

    const s = await settingsOf(a.tenantId);
    if (!bitrixOrderReady(s)) return reply.code(409).send({ error: 'order_not_set_up' });

    /*
     * Воронка. Оператор выбирает из тех, что ему открыли в настройках,
     * и проверяем это здесь, а не полагаемся на выпадающий список:
     * список живёт в браузере, а браузер присылает что угодно.
     */
    const asked = String(req.body?.pipeline ?? '');
    const pipe = s.pipelines.filter((p) => p.id === asked)[0] ?? (asked ? null : s.pipelines[0]);
    if (!pipe) return reply.code(400).send({ error: 'pipeline_not_allowed' });

    const items = orderItems(req.body?.items);
    const amount = bitrixAmount(req.body?.amount);
    if (!items.length && !amount) return reply.code(400).send({ error: 'empty_order' });

    let meta: Meta;
    try {
      meta = await metaOf(a.tenantId, got.link.call);
    } catch (err) {
      return reply.code(502).send(bitrixFail(err));
    }

    /*
     * Поля сделки. Принимаем только те, что Битрикс назвал сам и что
     * открыты в этой воронке. Обязательные проверяем заранее: отказ
     * приходит от Битрикса его словами и его именами полей, а человек
     * видел в окне подписи.
     */
    const open = bitrixPipelineFields(s, pipe.id);
    const shown = meta.fields.filter((f) => open.includes(f.api) || f.required);
    const picked = orderValues(shown, req.body?.fields);
    if (picked.missing.length) {
      return reply.code(400).send({ error: 'fields_required', detail: picked.missing.join(', ') });
    }

    const title = orderSubject(req.body?.subject, conv.display_name);
    const isLead = conv.crm_module === 'lead';

    const fields: Record<string, unknown> = {
      ...picked.values,
      TITLE: title,
      CATEGORY_ID: Number(pipe.id),
      STAGE_ID: pipe.stage,
      ...(isLead
        ? { LEAD_ID: Number(conv.crm_record_id) }
        : { CONTACT_IDS: [Number(conv.crm_record_id)] }),
      /*
       * Сумма руками — только без позиций. С позициями Битрикс считает
       * сам, и «своя» сумма поверх них означала бы сделку, в которой
       * итог не сходится со строками.
       */
      ...(items.length
        ? { IS_MANUAL_OPPORTUNITY: 'N' }
        : { OPPORTUNITY: amount, IS_MANUAL_OPPORTUNITY: 'Y' }),
    };

    try {
      const created = await got.link.call('crm.deal.add', {
        fields,
        // Лента компании не должна наполняться нашими сделками: их
        // заводит оператор в разговоре, и «в ленте» этого никто не ждёт.
        params: { REGISTER_SONET_EVENT: 'N' },
      });
      const dealId = Number(created);
      if (!dealId || Number.isNaN(dealId)) {
        return reply.code(502).send({ error: 'no_deal_id' });
      }

      if (items.length) {
        // Имена позиций берём из каталога портала: в строке сделки имя
        // хранится отдельно от товара, и пустое имя читается как
        // «неизвестно что» в печатной форме.
        const names = new Map<string, string>();
        const list = (await got.link.call('crm.product.list', {
          filter: { ID: items.map((i) => Number(i.productId)) },
          select: ['ID', 'NAME'],
        })) as Array<{ ID?: string | number; NAME?: string }> | null;
        for (const r of list ?? []) names.set(String(r?.ID ?? ''), String(r?.NAME ?? ''));

        await got.link.call('crm.item.productrow.set', {
          ownerType: 'D',
          ownerId: dealId,
          productRows: bitrixRows(items, names),
        });
      }

      deps.log('info', 'Сделка в Битриксе создана', { tenantId: a.tenantId, dealId });
      return { id: String(dealId), url: `${got.link.portal}/crm/deal/details/${dealId}/` };
    } catch (err) {
      return reply.code(502).send(bitrixFail(err));
    }
  });
}

/** Отказ портала словами портала: «не получилось» лечить нечем. */
function bitrixFail(err: unknown): { error: string; detail: string } {
  return err instanceof CrmError
    ? { error: err.code, detail: err.message }
    : { error: 'bitrix_failed', detail: 'Бітрікс не відповів' };
}

export interface BitrixOrderDeps {
  pool: Pool;
  masterKey: Buffer;
  requireAuth: (req: unknown) => { tenantId: string; userId: string } | null;
  log: (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void;
}

/** Адрес вкладки, которую Битрикс показывает внутри карточки. */
export function widgetUrl(deps: { appUrl: string }): string {
  return `${(deps.appUrl || '').replace(/\/+$/, '')}/widget/bitrix`;
}

/** Модуль карточки по коду места — нужен странице виджета. */
export { placementModule, placementRecord, bitrixHost };
