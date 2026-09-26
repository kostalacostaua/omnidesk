import type { FastifyInstance } from 'fastify';
import type { Queue } from 'bullmq';
import {
  WHATSAPP_USER_CHANNEL,
  decryptJson,
  jobKey,
  readGreen,
  withSystem,
  type GatewayCreds,
  type InboundJob,
  type Pool,
} from '@omnidesk/core';

/**
 * Приёмник вебхуков шлюза WhatsApp.
 *
 * Отдельным файлом, потому что это публичная дверь: сюда стучится чужой
 * сервер, без входа в кабинет и без нашей куки. Правил ровно три —
 * канал, ключ, содержимое, — и ни одного лишнего.
 *
 * Ключ проверяется сравнением с тем, что записано у канала. Поставщик
 * присылает его заголовком Authorization, как мы и просили при
 * настройке; чужой запрос без ключа отличается от нашего именно этим.
 *
 * Разбор тела делается здесь, а не в очереди, по одной причине: шлюз
 * шлёт в тот же адрес отметки о прочтении, состояния инстанса и звонки.
 * Класть их в очередь, чтобы воркер выбросил, — значит платить очередью
 * за мусор.
 */

interface GatewayDeps {
  pool: Pool;
  inboundQueue: Queue<InboundJob>;
  masterKey: Buffer;
  log: (level: string, msg: string, extra?: Record<string, unknown>) => void;
}

interface ChannelRow {
  channel_id: string;
  tenant_id: string;
  status: string;
  credentials_enc: Buffer | null;
}

/** Ключ из заголовка. Поставщик шлёт его как Bearer. */
export function hookToken(header: unknown): string {
  const raw = String(header ?? '').trim();
  return raw.toLowerCase().startsWith('bearer ') ? raw.slice(7).trim() : raw;
}

/**
 * Сравнение ключей за постоянное время.
 *
 * Обычное === выходит на первом несовпавшем символе, и по времени
 * ответа ключ подбирается посимвольно. Здесь это не паранойя: адрес
 * вебхука публичный, и стучаться в него можно сколько угодно.
 */
export function sameToken(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function registerGateway(app: FastifyInstance, deps: GatewayDeps): void {
  const { pool, inboundQueue, masterKey, log } = deps;

  app.post<{ Params: { id: string } }>('/webhooks/gateway/:id', async (req, reply) => {
    const channelId = String(req.params.id ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(channelId)) return reply.code(404).send({ error: 'not_found' });

    const row = await withSystem(pool, 'канал шлюза', async (db) => {
      const { rows } = await db.query<ChannelRow>(
        `SELECT r.channel_id, r.tenant_id, c.status, c.credentials_enc
           FROM channel_routes r JOIN channels c ON c.id = r.channel_id
          WHERE r.channel_id = $1 AND r.channel_type = $2 LIMIT 1`,
        [channelId, WHATSAPP_USER_CHANNEL],
      );
      return rows[0] ?? null;
    });

    /*
     * Отвечаем 200 даже на незнакомый канал.
     *
     * Поставщик на любой не-200 начинает долбить повторами, а канал уже
     * отключили — чинить нечего. Молчаливое «принято» останавливает
     * поток, а в журнале у нас остаётся след.
     */
    if (!row || row.status !== 'active' || !row.credentials_enc) {
      log('warn', 'Вебхук шлюза для отключённого канала', { channelId });
      return reply.code(200).send({ ok: true });
    }

    let creds: GatewayCreds & { hookToken?: string };
    try {
      creds = decryptJson<GatewayCreds & { hookToken?: string }>(
        masterKey,
        row.tenant_id,
        row.credentials_enc,
      );
    } catch {
      log('warn', 'Не удалось прочитать ключи канала шлюза', { channelId });
      return reply.code(200).send({ ok: true });
    }

    if (!sameToken(hookToken(req.headers['authorization']), String(creds.hookToken ?? ''))) {
      log('warn', 'Вебхук шлюза с чужим ключом', { channelId });
      return reply.code(401).send({ error: 'bad_token' });
    }

    const msg = readGreen(req.body);
    // Не сообщение — состояние, отметка о прочтении, звонок. Это не
    // ошибка: поставщик шлёт их в тот же адрес.
    if (!msg) return reply.code(200).send({ ok: true });

    await inboundQueue.add(
      'gateway',
      {
        provider: 'gateway',
        channelId: row.channel_id,
        tenantId: row.tenant_id,
        payload: msg,
        receivedAt: new Date().toISOString(),
      },
      // Номер сообщения у поставщика уникален и не меняется при
      // повторной доставке: второй раз то же сообщение не запишется.
      { jobId: jobKey('gw', msg.id) },
    );

    return reply.code(200).send({ ok: true });
  });
}
