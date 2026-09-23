import type { FastifyInstance } from 'fastify';
import {
  AiError,
  askModel,
  PROVIDERS,
  decryptJson,
  encryptJson,
  withTenant,
  type AiProvider,
  type AiTurn,
  type Pool,
} from '@omnidesk/core';

/**
 * Подключение ИИ и черновик ответа.
 *
 * Ключ приносит клиент: он платит провайдеру сам, сам видит расход и в
 * любой момент отзывает ключ. Нам остаётся хранить его зашифрованным и
 * никогда не возвращать наружу — в настройках видно только хвост.
 *
 * Черновик делается по кнопке оператора и ничего не отправляет. Это
 * намеренно первый режим: доверить переписку роботу без присмотра
 * готовы далеко не все, а подсказка под рукой полезна сразу.
 */

interface AiDeps {
  pool: Pool;
  masterKey: Buffer;
  requireAuth: (req: unknown) => { tenantId: string; userId: string } | null;
}

interface AiRow {
  provider: string;
  base_url: string;
  model: string;
  api_key_enc: Buffer | null;
  api_key_hint: string | null;
  system_prompt: string;
  mode: string;
  history_size: number;
  max_tokens: number;
  is_active: boolean;
  last_error: string | null;
}

const auth401 = { error: 'unauthorized' };

/** Хвост ключа для интерфейса: узнать свой ключ можно, списать — нет. */
export function keyHint(key: string): string {
  const tail = key.trim().slice(-4);
  return tail ? `…${tail}` : '';
}

/** Настройки наружу — без ключа. Он не покидает сервер ни разу. */
function publicView(row: AiRow | null) {
  if (!row) {
    return {
      connected: false, mode: 'off', provider: 'openai',
      baseUrl: PROVIDERS.openai.baseUrl, model: PROVIDERS.openai.model,
      systemPrompt: '', historySize: 12, maxTokens: 400, keyHint: '', lastError: null,
    };
  }
  return {
    connected: Boolean(row.api_key_enc) && row.is_active,
    mode: row.mode,
    provider: row.provider,
    baseUrl: row.base_url,
    model: row.model,
    systemPrompt: row.system_prompt,
    historySize: row.history_size,
    maxTokens: row.max_tokens,
    keyHint: row.api_key_hint ?? '',
    lastError: row.last_error,
  };
}

export function registerAi(app: FastifyInstance, deps: AiDeps): void {
  const { pool, masterKey, requireAuth } = deps;

  async function load(tenantId: string): Promise<AiRow | null> {
    return withTenant(pool, tenantId, async (db) => {
      const { rows } = await db.query<AiRow>(
        `SELECT provider, base_url, model, api_key_enc, api_key_hint, system_prompt,
                mode, history_size, max_tokens, is_active, last_error
           FROM ai_settings WHERE tenant_id = $1`,
        [tenantId],
      );
      return rows[0] ?? null;
    });
  }

  /** Расшифровать ключ. Возвращает пусто, если подключения ещё нет. */
  function readKey(tenantId: string, row: AiRow | null): string {
    if (!row?.api_key_enc) return '';
    try {
      return decryptJson<{ key: string }>(masterKey, tenantId, row.api_key_enc).key;
    } catch {
      return '';
    }
  }

  app.get('/settings/ai', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);
    return publicView(await load(a.tenantId));
  });

  app.put<{
    Body: {
      provider?: string; baseUrl?: string; model?: string; apiKey?: string; systemPrompt?: string;
      mode?: string; historySize?: number; maxTokens?: number;
    };
  }>('/settings/ai', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);

    const b = req.body ?? {};
    const provider: AiProvider = b.provider === 'gemini' ? 'gemini' : 'openai';
    // Пустой адрес — не ошибка, а «как у провайдера по умолчанию»:
    // у Gemini и OpenAI он разный, и заставлять его вводить незачем.
    const baseUrl = (b.baseUrl ?? '').trim() || PROVIDERS[provider].baseUrl;
    if (!/^https:\/\/\S+$/i.test(baseUrl)) {
      return reply.code(400).send({ error: 'bad_url', detail: 'Адреса має починатися з https://' });
    }
    const model = (b.model ?? '').trim();
    if (!model) return reply.code(400).send({ error: 'model_required' });

    const mode = ['off', 'draft', 'auto'].includes(b.mode ?? '') ? b.mode! : 'draft';
    const historySize = Math.min(40, Math.max(2, Number(b.historySize) || 12));
    const maxTokens = Math.min(2000, Math.max(50, Number(b.maxTokens) || 400));
    const systemPrompt = (b.systemPrompt ?? '').slice(0, 8000);
    const apiKey = (b.apiKey ?? '').trim();

    const existing = await load(a.tenantId);
    // Пустое поле ключа означает «оставить прежний», а не «стереть»:
    // иначе правка промпта каждый раз требовала бы вводить ключ заново.
    if (!apiKey && !existing?.api_key_enc) {
      return reply.code(400).send({ error: 'key_required' });
    }

    const enc = apiKey ? encryptJson(masterKey, a.tenantId, { key: apiKey }) : existing!.api_key_enc;
    const hint = apiKey ? keyHint(apiKey) : (existing?.api_key_hint ?? '');

    await withTenant(pool, a.tenantId, async (db) => {
      await db.query(
        `INSERT INTO ai_settings
           (tenant_id, provider, base_url, model, api_key_enc, api_key_hint, system_prompt,
            mode, history_size, max_tokens, is_active, last_error, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,NULL,now())
         ON CONFLICT (tenant_id) DO UPDATE SET
           provider = EXCLUDED.provider,
           base_url = EXCLUDED.base_url, model = EXCLUDED.model,
           api_key_enc = EXCLUDED.api_key_enc, api_key_hint = EXCLUDED.api_key_hint,
           system_prompt = EXCLUDED.system_prompt, mode = EXCLUDED.mode,
           history_size = EXCLUDED.history_size, max_tokens = EXCLUDED.max_tokens,
           is_active = true, last_error = NULL, updated_at = now()`,
        [a.tenantId, provider, baseUrl, model, enc, hint, systemPrompt, mode, historySize, maxTokens],
      );
    });

    app.log.info({ tenantId: a.tenantId, provider, model, mode }, 'ИИ подключён');
    return publicView(await load(a.tenantId));
  });

  app.delete('/settings/ai', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);
    await withTenant(pool, a.tenantId, async (db) => {
      await db.query(`DELETE FROM ai_settings WHERE tenant_id = $1`, [a.tenantId]);
    });
    return { ok: true };
  });

  /**
   * Проверка связи. Без неё человек узнаёт об опечатке в ключе не
   * сейчас, а когда клиент уже ждёт ответа в мессенджере.
   */
  app.post('/settings/ai/check', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);
    const row = await load(a.tenantId);
    const key = readKey(a.tenantId, row);
    if (!row || !key) return reply.code(400).send({ error: 'not_connected' });

    try {
      const text = await askModel(
        {
          provider: row.provider as AiProvider,
          baseUrl: row.base_url, apiKey: key, model: row.model,
          systemPrompt: row.system_prompt, maxTokens: 60,
        },
        [{ fromClient: true, text: 'Напиши одно короткое слово: готово' }],
        { timeoutMs: 20_000 },
      );
      await withTenant(pool, a.tenantId, async (db) => {
        await db.query(`UPDATE ai_settings SET last_error = NULL WHERE tenant_id = $1`, [a.tenantId]);
      });
      return { ok: true, sample: text.slice(0, 200) };
    } catch (err) {
      const message = err instanceof AiError ? err.message : 'Не удалось обратиться к провайдеру';
      await withTenant(pool, a.tenantId, async (db) => {
        await db.query(`UPDATE ai_settings SET last_error = $2 WHERE tenant_id = $1`,
          [a.tenantId, message]);
      });
      return reply.code(400).send({ error: 'check_failed', detail: message });
    }
  });

  /**
   * Черновик ответа для открытого диалога.
   *
   * Текст возвращается в поле ответа и ничего не отправляет: решение
   * за оператором. Историю берём в том порядке, в каком она была, и
   * ограничиваем настройкой — длинная переписка стоит денег за каждый
   * вызов.
   */
  app.post<{ Params: { id: string } }>('/conversations/:id/ai-draft', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);

    const row = await load(a.tenantId);
    const key = readKey(a.tenantId, row);
    if (!row || !key || row.mode === 'off' || !row.is_active) {
      return reply.code(400).send({ error: 'not_connected' });
    }

    const turns = await withTenant(pool, a.tenantId, async (db) => {
      const { rows } = await db.query<{ direction: string; body: string | null }>(
        `SELECT direction, body FROM messages
          WHERE conversation_id = $1 AND body IS NOT NULL AND body <> ''
          ORDER BY created_at DESC
          LIMIT $2`,
        [req.params.id, row.history_size],
      );
      return rows.reverse().map<AiTurn>((m) => ({
        fromClient: m.direction === 'in',
        text: m.body ?? '',
      }));
    });

    if (!turns.length) return reply.code(400).send({ error: 'nothing_to_answer' });

    try {
      const text = await askModel({
        provider: row.provider as AiProvider,
        baseUrl: row.base_url, apiKey: key, model: row.model,
        systemPrompt: row.system_prompt, maxTokens: row.max_tokens,
      }, turns);
      return { text };
    } catch (err) {
      const message = err instanceof AiError ? err.message : 'Не удалось обратиться к провайдеру';
      app.log.warn({ tenantId: a.tenantId, err: message }, 'Черновик ИИ не получился');
      await withTenant(pool, a.tenantId, async (db) => {
        await db.query(`UPDATE ai_settings SET last_error = $2 WHERE tenant_id = $1`,
          [a.tenantId, message]);
      });
      return reply.code(502).send({ error: 'ai_failed', detail: message });
    }
  });
}
