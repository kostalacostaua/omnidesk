import type { Redis } from 'ioredis';
import {
  CrmError,
  bitrixFindOrCreate,
  crmSource,
  decryptJson,
  parseCrmSettings,
  pipedriveFindOrCreate,
  withSystem,
  withTenant,
  zohoAccessToken,
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
    const { refreshToken } = decryptJson<{ refreshToken: string }>(
      masterKey,
      tenantId,
      inst.refresh_token_enc,
    );

    const out = await zohoAccessToken({
      cache: redis,
      tenantId,
      accountsServer: inst.accounts_server,
      refreshToken,
      clientId: deps.clientId,
      clientSecret: deps.clientSecret,
    });

    if (!out.ok) {
      // Доступ могли отозвать в Zoho. Помечаем установку — оператор
      // увидит на странице интеграций, что нужно подключить заново,
      // а не будет гадать, почему карточки перестали находиться.
      await withTenant(pool, tenantId, async (db) => {
        await db.query(`UPDATE zoho_installations SET status = 'degraded' WHERE id = $1`, [inst.id]);
      });
      log('warn', 'Zoho отклонила refresh-токен', { tenantId, error: out.error });
      return null;
    }
    return out.token;
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

  /**
   * Завести карточку: лид или контакт — как настроила компания.
   *
   * Поля у них почти одинаковые, и разница ровно в двух местах.
   * Lead_Source есть только у лида; у контакта источник кладём в
   * Description, потому что стандартного поля источника там нет, а
   * заводить своё за клиента мы не вправе — в его CRM это чужая схема.
   */
  async function createRecord(
    inst: Installation,
    token: string,
    contact: { name: string | null; phone: string | null },
    job: CrmSyncJob,
    createAs: 'lead' | 'contact',
  ): Promise<{ module: string; id: string } | null> {
    const source = crmSource(job.channelType);
    const moduleName = createAs === 'contact' ? 'Contacts' : 'Leads';
    const said = job.firstText ? `Перше повідомлення: ${job.firstText.slice(0, 500)}` : '';
    const from = `Звернення з ${source}`;

    const record: Record<string, unknown> = {
      // Фамилия — единственное обязательное поле и у лида, и у
      // контакта. Если человек не назвался, пишем канал: карточка «—»
      // в списке бесполезна.
      Last_Name: contact.name || `Клієнт з ${source}`,
      ...(contact.phone ? { Phone: contact.phone } : {}),
      Description: [from, said].filter(Boolean).join('\n'),
    };
    if (createAs === 'lead') record['Lead_Source'] = source;

    const res = await fetch(`${inst.api_domain}/crm/v6/${moduleName}`, {
      method: 'POST',
      headers: {
        authorization: `Zoho-oauthtoken ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ data: [record] }),
      signal: AbortSignal.timeout(20_000),
    });

    const body = (await res.json()) as {
      data?: Array<{ code?: string; details?: { id?: string }; message?: string }>;
    };
    const first = body.data?.[0];
    if (!res.ok || first?.code !== 'SUCCESS' || !first.details?.id) {
      log('warn', 'Zoho не создала карточку', {
        status: res.status, module: moduleName, message: first?.message,
      });
      return null;
    }
    return { module: moduleName, id: first.details.id };
  }

  /**
   * Найти сотрудника CRM по почте.
   *
   * По почте, а не по имени: имена в CRM пишут как придётся, «Оля» и
   * «Ольга Петренко» — один человек, а почта у него одна. Сравнение без
   * регистра, потому что почту вводят руками и в обоих местах.
   */
  async function zohoUserByEmail(
    inst: Installation,
    token: string,
    email: string,
  ): Promise<string | null> {
    const url = new URL(`${inst.api_domain}/crm/v6/users`);
    url.searchParams.set('type', 'ActiveUsers');
    const res = await fetch(url, {
      headers: { authorization: `Zoho-oauthtoken ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      log('warn', 'Zoho не отдала список сотрудников', { status: res.status });
      return null;
    }
    const body = (await res.json()) as { users?: Array<{ id?: string; email?: string }> };
    const want = email.trim().toLowerCase();
    const hit = (body.users ?? []).find((u) => (u.email ?? '').toLowerCase() === want);
    return hit?.id ?? null;
  }

  /**
   * Записать карточку на того, кто взял диалог.
   *
   * Молчит, когда сотрудника с такой почтой в CRM нет: это нормальная
   * жизнь — оператор чата не обязан быть пользователем CRM, и заводить
   * его там за компанию мы не будем.
   */
  async function assignOwner(job: CrmSyncJob): Promise<void> {
    if (!job.ownerEmail) return;

    const link = await withTenant(pool, job.tenantId, async (db) => {
      const { rows } = await db.query<{ crm_module: string | null; crm_record_id: string | null }>(
        `SELECT crm_module, crm_record_id FROM contacts WHERE id = $1`,
        [job.contactId],
      );
      return rows[0] ?? null;
    });
    if (!link?.crm_record_id || !link.crm_module) return;

    const inst = await installationFor(job.tenantId);
    if (!inst) return;
    const token = await accessToken(job.tenantId, inst);
    if (!token) return;

    const userId = await zohoUserByEmail(inst, token, job.ownerEmail);
    if (!userId) {
      log('debug', 'В Zoho нет сотрудника с такой почтой', { tenantId: job.tenantId });
      return;
    }

    const res = await fetch(`${inst.api_domain}/crm/v6/${link.crm_module}/${link.crm_record_id}`, {
      method: 'PUT',
      headers: {
        authorization: `Zoho-oauthtoken ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ data: [{ Owner: { id: userId } }] }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      log('warn', 'Zoho не сменила ответственного', { status: res.status });
      return;
    }
    log('info', 'Ответственный в Zoho обновлён', {
      module: link.crm_module, recordId: link.crm_record_id,
    });
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

    const source = crmSource(job.channelType);
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
    // Назначение ответственного — отдельный разговор: карточка уже
    // есть, искать и заводить нечего.
    if (job.kind === 'owner') {
      await assignOwner(job);
      return;
    }

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
      const settings = await withSystem(pool, 'настройки CRM', async (db) => {
        const { rows } = await db.query<{ crm: unknown }>(
          `SELECT crm FROM tenants WHERE id = $1 LIMIT 1`,
          [job.tenantId],
        );
        return parseCrmSettings(rows[0]?.crm);
      });

      link = await createRecord(
        inst,
        token,
        { name: contact.display_name, phone: contact.phone_e164 },
        job,
        settings.createAs,
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

    log('info', found ? 'Контакт найден в Zoho' : 'В Zoho заведена карточка', {
      contactId: job.contactId,
      module: link.module,
      recordId: link.id,
    });
  };
}
