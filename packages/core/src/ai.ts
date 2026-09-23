/**
 * Разговор с моделью.
 *
 * Провайдер здесь один — «совместимый с OpenAI»: у OpenAI, Groq,
 * Together, OpenRouter, локальной Ollama и почти всех остальных один и
 * тот же адрес /chat/completions и один и тот же формат. Писать под
 * каждого отдельный переходник значило бы поддерживать десяток почти
 * одинаковых файлов ради поля, которое клиент и так вводит руками.
 *
 * Сеть вынесена параметром (fetchImpl), чтобы сборку запроса и разбор
 * ответа можно было проверить тестами без единого обращения наружу.
 */

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  maxTokens: number;
}

export interface AiTurn {
  /** true — написал клиент, false — наша сторона (оператор или бот). */
  fromClient: boolean;
  text: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Ошибка с человеческой причиной: её показываем в настройках. */
export class AiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

/**
 * Правила поведения, которые дописываются к тексту клиента.
 *
 * Клиент пишет про свою компанию, а не про то, как модели себя вести.
 * Эти строки закрывают три беды живого разговора с ботом: длинные
 * простыни вместо ответа, выдуманные цены и сроки, и бодрое «конечно,
 * сделаем» там, где нужен человек.
 */
const RULES = [
  'Ты — оператор поддержки в переписке мессенджера. Отвечай коротко: одно-три предложения.',
  'Пиши на языке последнего сообщения клиента.',
  'Не выдумывай цены, сроки, наличие и условия. Не знаешь — так и скажи и предложи уточнить.',
  'Если клиент просит человека, жалуется или речь о деньгах и возврате — скажи, что зовёшь оператора.',
  'Без приветствий в каждом сообщении и без подписи.',
].join(' ');

/** Собрать переписку в том виде, в каком её понимает модель. */
export function buildMessages(cfg: Pick<AiConfig, 'systemPrompt'>, turns: AiTurn[]): ChatMessage[] {
  const about = cfg.systemPrompt.trim();
  const system = about ? `${RULES}\n\nО компании:\n${about}` : RULES;

  const history: ChatMessage[] = [];
  for (const t of turns) {
    const text = (t.text ?? '').trim();
    if (!text) continue;
    history.push({ role: t.fromClient ? 'user' : 'assistant', content: text });
  }

  return [{ role: 'system', content: system }, ...history];
}

/** Разобрать ответ провайдера. Пустой ответ — это тоже ошибка. */
export function readCompletion(payload: unknown): string {
  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> })?.choices;
  const raw = Array.isArray(choices) ? choices[0]?.message?.content : undefined;
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) throw new AiError('Модель вернула пустой ответ', 'empty_answer');
  return text;
}

/** Причина отказа словами, которые можно показать в настройках. */
export function explainStatus(status: number): AiError {
  if (status === 401 || status === 403) {
    return new AiError('Ключ не подошёл — проверьте его в кабинете провайдера', 'bad_key');
  }
  if (status === 404) {
    return new AiError('Провайдер не знает такой модели или адреса', 'bad_model');
  }
  if (status === 429) {
    return new AiError('Провайдер отвечает «слишком часто» — кончился лимит или деньги', 'rate_limit');
  }
  if (status >= 500) return new AiError('Провайдер отвечает ошибкой', 'provider_down');
  return new AiError(`Провайдер отказал (${status})`, 'refused');
}

/** Адрес запроса: клиент вводит корень, слеш на конце не важен. */
export function completionsUrl(baseUrl: string): string {
  const root = baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(root)) throw new AiError('Адрес должен начинаться с https://', 'bad_url');
  return root.endsWith('/chat/completions') ? root : `${root}/chat/completions`;
}

type FetchLike = (url: string, init: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/**
 * Спросить модель. Таймаут обязателен: без него зависший провайдер
 * держит задачу очереди, пока та не упадёт по своему сроку, а клиент
 * всё это время ждёт ответа в мессенджере.
 */
export async function askModel(
  cfg: AiConfig,
  turns: AiTurn[],
  opts: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<string> {
  const doFetch = (opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike));
  const url = completionsUrl(cfg.baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 25_000);

  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: buildMessages(cfg, turns),
        max_tokens: cfg.maxTokens,
        temperature: 0.4,
      }),
      signal: controller.signal,
    });

    if (!res.ok) throw explainStatus(res.status);
    return readCompletion(await res.json());
  } catch (err) {
    if (err instanceof AiError) throw err;
    const name = (err as { name?: string })?.name;
    if (name === 'AbortError') throw new AiError('Провайдер не ответил вовремя', 'timeout');
    throw new AiError('Не удалось обратиться к провайдеру', 'network');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Нужен ли здесь человек.
 *
 * Автоответ не должен разговаривать там, где ошибка стоит денег или
 * нервов. Проверка простая и намеренно грубая: слова о возврате,
 * жалобе, счёте и прямая просьба позвать оператора.
 */
const HANDOFF = [
  'оператор', 'человек', 'менеджер', 'жалоб', 'верните', 'возврат', 'деньги назад',
  'обман', 'суд', 'претенз', 'рекламац',
  'оператора', 'людина', 'скарг', 'поверн', 'гроші назад',
];

export function needsHuman(text: string): boolean {
  const low = (text || '').toLowerCase();
  return HANDOFF.some((w) => low.includes(w));
}
