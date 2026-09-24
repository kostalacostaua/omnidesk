import type { FastifyInstance } from 'fastify';
import type { Queue } from 'bullmq';
import { randomBytes } from 'node:crypto';
import {
  CUSTOM_CHANNEL,
  isCustomKey,
  jobKey,
  normalizeCustom,
  withSystem,
  type InboundJob,
  type Pool,
} from '@omnidesk/core';

/**
 * Свой канал: публичная часть.
 *
 * Один обработчик, и вся его работа — впустить чужой код в общую ленту.
 * Поэтому здесь ровно три проверки и ни одной лишней: ключ, частота,
 * содержимое. Всё, что можно сделать дальше по конвейеру, делается
 * дальше: канал не знает ни про контакты, ни про CRM, ни про бота.
 *
 * Ключ проверяется сравнением с тем, что записано у канала. Он длинный
 * и случайный, и это единственное, чем клиент доказывает, что канал
 * его. Ни подписи, ни списка адресов здесь нет намеренно: клиент может
 * писать откуда угодно, в том числе из чужого облака, и привязка к
 * адресу сломала бы ровно тех, ради кого канал и сделан.
 */

interface CustomDeps {
  pool: Pool;
  inboundQueue: Queue<InboundJob>;
  log: (level: string, msg: string, extra?: Record<string, unknown>) => void;
}

interface ChannelRow {
  channel_id: string;
  tenant_id: string;
  status: string;
}

/** Не больше сообщения в секунду с канала и 600 в минуту. */
const RATE = new Map<string, { last: number; minute: number; count: number }>();

function rateOk(channelId: string): boolean {
  const now = Date.now();
  const minute = Math.floor(now / 60_000);
  const seen = RATE.get(channelId);

  if (!seen || seen.minute !== minute) {
    RATE.set(channelId, { last: now, minute, count: 1 });
    if (RATE.size > 5000) {
      for (const [key, value] of RATE) if (value.minute < minute) RATE.delete(key);
    }
    return true;
  }
  // Предел щедрый: на той стороне не человек, а код, и всплеск в сотню
  // сообщений при разборе очереди — нормальная жизнь, а не нападение.
  if (seen.count >= 600) return false;

  seen.last = now;
  seen.count += 1;
  return true;
}

export function registerCustom(app: FastifyInstance, deps: CustomDeps): void {
  const { pool, inboundQueue, log } = deps;

  async function channelByKey(key: string): Promise<ChannelRow | null> {
    if (!isCustomKey(key)) return null;
    return withSystem(pool, 'свой канал по ключу', async (db) => {
      const { rows } = await db.query<ChannelRow>(
        `SELECT channel_id, tenant_id, status FROM channel_routes
          WHERE channel_type = $1 AND external_id = $2 LIMIT 1`,
        [CUSTOM_CHANNEL, key],
      );
      return rows[0] ?? null;
    });
  }

  /**
   * Входящее из своего канала.
   *
   * Ключ идёт заголовком, а не в адресе: адреса попадают в логи чужих
   * прокси и в историю браузера, и ключ вместе с ними.
   */
  app.post<{
    Body: {
      peerId?: string;
      name?: string;
      text?: string;
      externalId?: string;
    };
  }>('/channels/custom/messages', async (req, reply) => {
    const header = req.headers['authorization'];
    const key = typeof header === 'string' && header.startsWith('Bearer ')
      ? header.slice(7).trim()
      : '';

    const row = await channelByKey(key);
    if (!row) return reply.code(401).send({ error: 'bad_key' });
    if (row.status !== 'active') return reply.code(409).send({ error: 'channel_disabled' });

    if (!rateOk(row.channel_id)) return reply.code(429).send({ error: 'too_fast' });

    /*
     * Идентификатор сообщения: берём присланный, если он есть. Клиент
     * знает про повторы больше нашего — он их и порождает, когда его
     * собственный обработчик падает на середине и платформа шлёт
     * обновление второй раз.
     */
    const given = String(req.body?.externalId ?? '').trim().slice(0, 190);
    const externalId = given || `cu_${Date.now()}_${randomBytes(4).toString('hex')}`;

    const message = normalizeCustom(
      {
        peerId: req.body?.peerId ?? '',
        name: req.body?.name ?? null,
        text: req.body?.text ?? '',
        externalId,
      },
      { tenantId: row.tenant_id, channelId: row.channel_id, externalId },
    );
    if (!message) return reply.code(400).send({ error: 'peer_and_text_required' });

    await inboundQueue.add(
      'custom',
      {
        provider: 'custom',
        channelId: row.channel_id,
        tenantId: row.tenant_id,
        payload: { ...message, sentAt: message.sentAt.toISOString() },
        receivedAt: new Date().toISOString(),
      },
      { jobId: jobKey('cu', row.channel_id, externalId) },
    );

    log('info', 'Входящее из своего канала', { channelId: row.channel_id });
    return reply.code(202).send({ ok: true, messageId: externalId });
  });
}
