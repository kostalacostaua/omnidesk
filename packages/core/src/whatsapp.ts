/**
 * WhatsApp Business через Cloud API.
 *
 * Отличий от Messenger и Instagram три, и все три меняют поведение
 * интерфейса, а не только код отправки.
 *
 * Первое — окно. Написать первым нельзя: свободный текст уходит только
 * в течение суток после сообщения клиента. Дальше — одобренные шаблоны,
 * и это не наше ограничение, а правило WhatsApp. Оно уже живёт в
 * `computeResponseWindow` и `canSendFreeform`.
 *
 * Второе — шаблон это не текст. У него есть имя, язык и переменные, и
 * каждый шаблон проходит проверку в Meta. Отправить «почти такой же, но
 * своими словами» нельзя.
 *
 * Третье — вложения. Ссылку на файл WhatsApp скачивает сам, но только
 * публичную; наши файлы лежат в закрытом хранилище. Поэтому файл
 * сначала загружается в Meta и отправляется по её идентификатору.
 */

export interface WaText {
  to: string;
  text: string;
  /** Идентификатор сообщения клиента, если это ответ на конкретное. */
  replyTo?: string;
}

export interface WaMedia {
  to: string;
  /** Идентификатор загруженного файла (не ссылка: хранилище закрытое). */
  mediaId: string;
  kind: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  caption?: string;
  filename?: string;
  replyTo?: string;
}

export interface WaTemplate {
  to: string;
  name: string;
  language: string;
  /** Значения {{1}}, {{2}} … по порядку. */
  params?: string[];
}

type Body = Record<string, unknown>;

function withContext(body: Body, replyTo?: string): Body {
  return replyTo ? { ...body, context: { message_id: replyTo } } : body;
}

export function waTextBody(m: WaText): Body {
  return withContext(
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: m.to,
      type: 'text',
      // preview_url разрешает WhatsApp показать карточку ссылки. Без
      // него оператор шлёт ссылку, а клиент видит голый адрес.
      text: { body: m.text, preview_url: true },
    },
    m.replyTo,
  );
}

export function waMediaBody(m: WaMedia): Body {
  const payload: Body = { id: m.mediaId };
  // Подпись есть у картинки, видео и документа; у голоса и стикера её
  // нет, и Meta отвечает ошибкой, если прислать.
  if (m.caption && m.kind !== 'audio' && m.kind !== 'sticker') payload['caption'] = m.caption;
  if (m.filename && m.kind === 'document') payload['filename'] = m.filename;

  return withContext(
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: m.to,
      type: m.kind,
      [m.kind]: payload,
    },
    m.replyTo,
  );
}

export function waTemplateBody(m: WaTemplate): Body {
  const params = m.params ?? [];
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: m.to,
    type: 'template',
    template: {
      name: m.name,
      language: { code: m.language },
      ...(params.length
        ? {
            components: [
              {
                type: 'body',
                parameters: params.map((text) => ({ type: 'text', text })),
              },
            ],
          }
        : {}),
    },
  };
}

/** Наш тип вложения → тип WhatsApp. */
export function waKind(type: string, mime?: string): WaMedia['kind'] {
  if (type === 'image') return 'image';
  if (type === 'video') return 'video';
  if (type === 'sticker') return 'sticker';
  if (type === 'audio' || type === 'voice') return 'audio';
  if (mime?.startsWith('image/')) return 'image';
  return 'document';
}

export interface WaTemplateInfo {
  name: string;
  language: string;
  status: string;
  category: string;
  /** Текст тела с {{1}} — по нему оператор узнаёт шаблон. */
  body: string;
  /** Сколько значений нужно подставить. */
  variables: number;
}

/**
 * Разбор списка шаблонов.
 *
 * Отсюда берётся то, что оператор видит вместо поля ответа, когда окно
 * закрыто. Шаблоны не в статусе APPROVED показывать бессмысленно:
 * WhatsApp откажет при отправке.
 */
export function parseTemplates(raw: unknown): WaTemplateInfo[] {
  const list = (raw as { data?: unknown[] })?.data ?? [];
  const out: WaTemplateInfo[] = [];

  for (const item of list) {
    const t = item as {
      name?: string;
      language?: string;
      status?: string;
      category?: string;
      components?: Array<{ type?: string; text?: string }>;
    };
    if (!t.name) continue;

    const body = (t.components ?? []).find((c) => (c.type ?? '').toUpperCase() === 'BODY');
    const text = body?.text ?? '';
    const found = text.match(/\{\{\s*\d+\s*\}\}/g) ?? [];

    out.push({
      name: t.name,
      language: t.language ?? 'uk',
      status: (t.status ?? '').toUpperCase(),
      category: (t.category ?? '').toUpperCase(),
      body: text,
      variables: new Set(found.map((v) => v.replace(/[^0-9]/g, ''))).size,
    });
  }

  return out;
}

/** Подставить значения в текст шаблона — для показа оператору. */
export function fillTemplate(body: string, params: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n: string) => params[Number(n) - 1] ?? `{{${n}}}`);
}

/**
 * Номер в том виде, в каком его ждёт WhatsApp.
 *
 * Без плюса и без разделителей. Плюс в поле `to` Meta не принимает, а
 * номер с ним выглядит правильным — поэтому ошибка молчаливая.
 */
export function waNumber(raw: string): string {
  return (raw ?? '').replace(/[^0-9]/g, '');
}

/**
 * Идентификатор аккаунта WhatsApp Business, к которому привязан номер.
 *
 * Спросить его напрямую у номера нельзя: Graph такого поля не отдаёт.
 * Зато его отдаёт проверка самого токена — в granular_scopes лежат права
 * и список объектов, на которые они выданы. Для системного пользователя
 * с доступом к аккаунту это и есть нужный идентификатор.
 */
export interface DebugTokenReply {
  data?: {
    granular_scopes?: Array<{ scope?: string; target_ids?: string[] }>;
  };
}

export function wabaFromDebug(reply: DebugTokenReply): string | null {
  const scopes = reply?.data?.granular_scopes ?? [];
  // Управление аккаунтом выдаётся именно на аккаунты, поэтому список
  // целей у него и есть перечень доступных WABA. Права на отправку
  // выдаются шире и для поиска аккаунта не годятся.
  const wanted = ['whatsapp_business_management', 'whatsapp_business_messaging'];
  for (const name of wanted) {
    const hit = scopes.find((s) => s.scope === name && (s.target_ids?.length ?? 0) > 0);
    if (hit?.target_ids?.[0]) return hit.target_ids[0];
  }
  return null;
}
