/**
 * Разговор с моделью.
 *
 * Форматов два, и это не прихоть. Первый — «совместимый с OpenAI»: у
 * самого OpenAI, Groq, Together, OpenRouter и локальной Ollama один и
 * тот же адрес /chat/completions и одно и то же тело, поэтому все они
 * идут одной дорогой. Второй — Google Gemini: у неё свой запрос
 * (contents/parts вместо messages) и свой заголовок с ключом.
 *
 * У Gemini есть и совместимый с OpenAI слой, но он держится отдельно
 * от основного API и помечен как переходный — строить на нём ответы
 * клиентам значит зависеть от того, что Google в любой момент назовёт
 * необязательным. Родной формат — тридцать строк и никакой зависимости.
 *
 * Сеть вынесена параметром (fetchImpl), чтобы сборку запроса и разбор
 * ответа можно было проверить тестами без единого обращения наружу.
 */

export type AiProvider = 'openai' | 'gemini';

export interface AiConfig {
  /**
   * Кто отвечает. openai — все, у кого есть /chat/completions (сам
   * OpenAI, OpenRouter, Groq, локальная модель). gemini — Google: у
   * неё свой формат запроса, и переводить его в чужой значило бы
   * зависеть от совместимого слоя, который Google держит отдельно.
   */
  provider?: AiProvider;
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

/** Куда ходить по умолчанию и какая модель разумна у каждого. */
export const PROVIDERS: Record<AiProvider, { baseUrl: string; model: string; title: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', title: 'OpenAI и совместимые' },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-3.8-flash',
    title: 'Google Gemini',
  },
};

/** Правила поведения одни на всех: они про разговор, а не про формат. */
export function systemText(systemPrompt: string): string {
  const about = (systemPrompt ?? '').trim();
  return about ? `${RULES}\n\nО компании:\n${about}` : RULES;
}

/** Собрать переписку в том виде, в каком её понимает модель. */
export function buildMessages(cfg: Pick<AiConfig, 'systemPrompt'>, turns: AiTurn[]): ChatMessage[] {
  const system = systemText(cfg.systemPrompt);

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

/* ── Google Gemini ──────────────────────────────────────────────── */

/**
 * Адрес Gemini: модель входит в путь, а не в тело запроса.
 *
 * Ключ идёт заголовком x-goog-api-key, хотя Google показывает в
 * примерах и параметр ?key=. Параметр попадает в журналы прокси и в
 * историю — ключ в таком месте считается утёкшим.
 */
export function geminiUrl(baseUrl: string, model: string): string {
  const root = (baseUrl || PROVIDERS.gemini.baseUrl).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(root)) throw new AiError('Адрес должен начинаться с https://', 'bad_url');
  const name = model.trim().replace(/^models\//, '');
  if (!name) throw new AiError('Не указана модель', 'bad_model');
  return `${root}/models/${name}:generateContent`;
}

/** Тело запроса Gemini: свои имена ролей и отдельная системная часть. */
export function buildGemini(
  cfg: Pick<AiConfig, 'systemPrompt' | 'maxTokens'>,
  turns: AiTurn[],
): Record<string, unknown> {
  const contents = turns
    .filter((t) => (t.text ?? '').trim())
    .map((t) => ({
      role: t.fromClient ? 'user' : 'model',
      parts: [{ text: t.text.trim() }],
    }));

  return {
    systemInstruction: { parts: [{ text: systemText(cfg.systemPrompt) }] },
    contents,
    generationConfig: { maxOutputTokens: cfg.maxTokens, temperature: 0.4 },
  };
}

/** Разобрать ответ Gemini. Обрыв по фильтру — причина, а не пустота. */
export function readGemini(payload: unknown): string {
  const data = payload as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> }; finishReason?: string }>;
    promptFeedback?: { blockReason?: string };
  };

  const blocked = data?.promptFeedback?.blockReason;
  if (blocked) throw new AiError('Gemini отказалась отвечать на этот текст', 'blocked');

  const first = data?.candidates?.[0];
  if (first?.finishReason === 'SAFETY') {
    throw new AiError('Gemini отказалась отвечать на этот текст', 'blocked');
  }

  const text = (first?.content?.parts ?? [])
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .join('')
    .trim();

  if (!text) throw new AiError('Модель вернула пустой ответ', 'empty_answer');
  return text;
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
  const gemini = cfg.provider === 'gemini';
  const url = gemini ? geminiUrl(cfg.baseUrl, cfg.model) : completionsUrl(cfg.baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 25_000);

  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: gemini
        ? { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey }
        : { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(
        gemini
          ? buildGemini(cfg, turns)
          : {
              model: cfg.model,
              messages: buildMessages(cfg, turns),
              max_tokens: cfg.maxTokens,
              temperature: 0.4,
            },
      ),
      signal: controller.signal,
    });

    if (!res.ok) throw explainStatus(res.status);
    const payload = await res.json();
    return gemini ? readGemini(payload) : readCompletion(payload);
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
