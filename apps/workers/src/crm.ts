import type { Redis } from 'ioredis';
import {
  CrmError,
  bitrixFindOrCreate,
  decryptJson,
  pipedriveFindOrCreate,
  withTenant,
  type CrmKind,
  type CrmSyncJob,
  type Pool,
} from '@omnidesk/core';

/**
 * Связка контакта с Zoho CRM.
 *
 * Что делает: по входящему от нового человека ищет его в CRM клиента по
 * номеру телефона. Нашёл — привязывает диалог к существующей карточке,
 * не нашёл — заводит лид, чтобы обращение не потерялось между
 * мессенджером и отделом продаж.
 *
 * Почему отдельной задачей, а не внутри обработки сообщения: поход в
 * чужой API занимает секунды и падает по причинам, которые от нас не
 * зависят. Сообщение клиента обязано быть записано и показано оператору
 * немедленно, даже если CRM сейчас недоступна.
 *
 * Токен доступа живёт час. Держим его в Redis на пятьдесят минут: без
 * этого каждое сообщение начиналось бы с обмена refresh-токена, а Zoho
 * считает такие обмены и режет при превышении.
 */

export interface CrmDeps {
  pool: Pool;
  redis: Redis;
  masterKey: Buffer;
  clientId: string;
  clientSecret: string;
  log: (level: 'info' | 'warn' | 'error' | 'debug', msg: string, extra?: Record<string, unknown>) => void;
}

interface Installation {
  id: string;
  accounts_server: string;
  api_domain: string;
  refresh_token_enc: Buffer;
}

const TOKEN_TTL_SEC = 50 * 60;

/** Названия каналов для поля «источник» в CRM: там читают люди, а не программы. */
const SOURCE: Record<string, string> = {
  telegram: 'Telegram',
  telegram_bot: 'Telegram',
  telegram_user: 'Telegram',
  instagram: 'Instagram Direct',
  messenger: 'Facebook Messenger',
};

export function createCrmSync(deps: CrmDeps) {
  const { pool, redis, masterKey, log } = deps;

  async function installationFor(tenantId: string): Promise<Installation | null> {
    return withTenant(pool, tenantId, async (db) => {
      const { rows } = await db.query<Installation>(
        `SELECT id, accounts_server, api_domain, refresh_token_enc
           FROM zoho_installations
          WHERE status = 'active'
          ORDER BY created_at DESC LIMIT 1`,
      );
      return rows[0] ?? null;
    });
  }

  async function accessToken(tenantId: string, inst: Installation): Promise<string | null> {
    const key = `zoho:at:${tenantId}`;
    const cached = await redis.get(key);
    if (cached) return cached;

    const { refreshToken } = decryptJson<{ refreshToken: string }>(
      masterKey,
      tenantId,
      inst.refresh_token_enc,
    );

    const res = await fetch(`${inst.accounts_server}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: deps.clientId,
        client_secret: deps.clientSecret,
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json()) as { access_token?: string; error?: string };

    if (!res.ok || !body.access_token) {
      // Доступ могли отозвать в Zoho. Помечаем установку — оператор
      // увидит на странице интеграций, что нужно подключить заново,
      // а не будет гадать, почему карточки перестали находиться.
      await withTenant(pool, tenantId, async (db) => {
        await db.query(`UPDATE zoho_installations SET status = 'degraded' WHERE id = $1`, [inst.id]);
      });
      log('warn', 'Zoho отклонила refresh-токен', { tenantId, error: body.error });
      return null;
    }

    await redis.set(key, body.access_token, 'EX', TOKEN_TTL_SEC);
    return body.access_token;
  }

  /** Поиск по номеру. Zoho ищет по точному совпадению, поэтому номер идёт как есть. */
  async function findByPhone(
    inst: Installation,
    token: string,
    phone: string,
  ): Promise<{ module: string; id: string } | null> {
    for (const moduleName of ['Contacts', 'Leads']) {
      const url = new URL(`${inst.api_domain}/crm/v6/${moduleName}/search`);
      url.searchParams.set('phone', phone);
      const res = await fetch(url, {
        headers: { authorization: `Zoho-oauthtoken ${token}` },
        signal: AbortSignal.timeout(20_000),
      });
      // 204 означает «ничего не найдено» — это нормальный ответ, не ошибка.
      if (res.status === 204) continue;
      if (!res.ok) {
        log('warn', 'Поиск в Zoho вернул ошибку', { status: res.status, module: moduleName });
        continue;
      }
      const body = (await res.json()) as { data?: Array<{ id?: string }> };
      const id = body.data?.[0]?.id;
      if (id) return { module: moduleName, id };
    }
    return null;
  }

  async function createLead(
    inst: Installation,
    token: string,
    contact: { name: string | null; phone: string | null },
    job: CrmSyncJob,
  ): Promise<{ module: string; id: string } | null> {
    const source = SOURCE[job.channelType] ?? job.channelType;
    const res = await fetch(`${inst.api_domain}/crm/v6/Leads`, {
      method: 'POST',
      headers: {
        authorization: `Zoho-oauthtoken ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        data: [
          {
            // Фамилия — единственное обязательное поле лида в Zoho.
            // Если человек не назвался, пишем канал: пустая карточка
            // «—» в списке лидов бесполезна.
            Last_Name: contact.name || `Клиент из ${source}`,
            ...(contact.phone ? { Phone: contact.phone } : {}),
            Lead_Source: source,
            Description: job.firstText
              ? `Первое сообщение: ${job.firstText.slice(0, 500)}`
              : `Обращение из ${source}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });

    const body = (await res.json()) as {
      data?: Array<{ code?: string; details?: { id?: string }; message?: string }>;
    };
    const first = body.data?.[0];
    if (!res.ok || first?.code !== 'SUCCESS' || !first.details?.id) {
      log('warn', 'Zoho не создала лид', { status: res.status, message: first?.message });
      return null;
    }
    return { module: 'Leads', id: first.details.id };
  }

  /**
   * Битрикс24 и Pipedrive.
   *
   * Обе делают одно и то же: ищут клиента по телефону и заводят
   * карточку, если его нет. Ключ лежит зашифрованным и расшифровывается
   * ровно на время запроса — в памяти воркера он не живёт.
   *
   * Ошибку CRM записываем в подключение: «лиды не создаются» без
   * причины ищут по логам сервера, куда клиент не заглянет.
   */
  async function syncSimpleCrm(
    job: CrmSyncJob,
    contact: { display_name: string | null; phone_e164: string | null },
  ): Promise<boolean> {
    const conn = await withTenant(pool, job.tenantId, async (db) => {
      const { rows } = await db.query<{ id: string; kind: string; creds_enc: Buffer }>(
        `SELECT id, kind, creds_enc FROM crm_connections
          WHERE status = 'active' ORDER BY created_at ASC LIMIT 1`,
      );
      return rows[0] ?? null;
    });
    if (!conn) return false;

    const source = SOURCE[job.channelType] ?? job.channelType;
    const person = {
      name: contact.display_name ?? '',
      phone: contact.phone_e164,
      source,
    };

    try {
      const creds = decryptJson<{ webhook?: string; domain?: string; token?: string }>(
        masterKey, job.tenantId, conn.creds_enc,
      );
      const match = conn.kind === 'bitrix24'
        ? await bitrixFindOrCreate(creds.webhook ?? '', person)
        : await pipedriveFindOrCreate(creds.domain ?? '', creds.token ?? '', person);

      await withTenant(pool, job.tenantId, async (db) => {
        await db.query(
          `UPDATE contacts SET crm_kind = $2, crm_module = $3, crm_record_id = $4
            WHERE id = $1 AND crm_record_id IS NULL`,
          [job.contactId, conn.kind, match.module, match.recordId],
        );
      });

      log('info', 'Контакт связан с CRM', {
        contactId: job.contactId, crm: conn.kind, module: match.module, recordId: match.recordId,
      });
      return true;
    } catch (err) {
      const message = err instanceof CrmError ? err.message : 'CRM не ответила';
      log('warn', 'CRM не приняла контакт', { crm: conn.kind, reason: message });
      await withTenant(pool, job.tenantId, async (db) => {
        await db.query(
          `UPDATE crm_connections SET status = 'degraded', last_error = $2 WHERE id = $1`,
          [conn.id, message],
        );
      });
      return true; // подключение есть, просто сейчас не вышло
    }
  }

  return async function handleCrmSync(job: CrmSyncJob): Promise<void> {
    const contactRow = await withTenant(pool, job.tenantId, async (db) => {
      const { rows } = await db.query<{
        display_name: string | null;
        phone_e164: string | null;
        crm_record_id: string | null;
      }>(`SELECT display_name, phone_e164, crm_record_id FROM contacts WHERE id = $1`, [
        job.contactId,
      ]);
      return rows[0] ?? null;
    });

    if (!contactRow) return;
    // Связь уже есть — второй раз не ищем и лид не плодим.
    if (contactRow.crm_record_id) return;

    const contact = contactRow;

    // Zoho идёт первой: у неё в карточке живёт наш виджет, и связь с
    // ней ценнее. Нет Zoho — пробуем Битрикс или Pipedrive.
    const inst = await installationFor(job.tenantId);
    if (!inst) {
      const handled = await syncSimpleCrm(job, contact);
      if (!handled) {
        log('debug', 'CRM не подключена, связывать не с чем', { tenantId: job.tenantId });
      }
      return;
    }

    const token = await accessToken(job.tenantId, inst);
    if (!token) return;

    let link = contact.phone_e164 ? await findByPhone(inst, token, contact.phone_e164) : null;
    const found = Boolean(link);

    if (!link) {
      link = await createLead(
        inst,
        token,
        { name: contact.display_name, phone: contact.phone_e164 },
        job,
      );
    }
    if (!link) return;

    await withTenant(pool, job.tenantId, async (db) => {
      await db.query(
        `UPDATE contacts SET crm_module = $2, crm_record_id = $3 WHERE id = $1
           AND crm_record_id IS NULL`,
        [job.contactId, link.module, link.id],
      );
    });

    log('info', found ? 'Контакт найден в Zoho' : 'В Zoho заведён лид', {
      contactId: job.contactId,
      module: link.module,
      recordId: link.id,
    });
  };
}
