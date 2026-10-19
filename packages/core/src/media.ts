/**
 * Чем отдавать файл, который прислал посторонний.
 *
 * Вложение приходит снаружи — из мессенджера, из окна чата на сайте, из
 * шаблона, который завёл сотрудник. Вместе с байтами приходит и тип, и
 * раньше мы отдавали его обратно как есть. Telegram позволяет
 * отправителю назначить mime_type произвольно; остальные каналы не
 * строже.
 *
 * Чем это кончается. Кабинет забирает файл запросом с токеном и
 * открывает локальную копию: blob наследует тип ответа и наш домен.
 * Файл с типом text/html — уже не файл, а страница, выполняющаяся от
 * имени кабинета, и первое, что она делает, — читает localStorage, где
 * лежит токен. Клиент из переписки получает чужую учётную запись.
 *
 * Поэтому тип не передаётся дальше, а назначается: показываем в окне
 * только то, что заведомо не умеет исполняться, остальное отдаём на
 * скачивание под нейтральным типом. Список, а не правило: «начинается с
 * image/» сюда пропускает image/svg+xml, а SVG — это документ со
 * скриптом, и именно так эту дыру обычно и проходят.
 *
 * Список закрытый и короткий намеренно. Неизвестный тип скачивается —
 * файл при этом не теряется, человек открывает его у себя. Пропустить
 * неизвестное в окно стоило бы дороже, чем лишний раз скачать.
 */

/** Что показываем прямо в окне. Всё остальное — на скачивание. */
const INLINE_SAFE = new Set([
  'image/jpeg',
  'image/pjpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/heic',
  'image/heif',
  'image/x-icon',
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'video/3gpp',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/ogg',
  'audio/opus',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/aac',
  'audio/amr',
  'audio/flac',
]);

export interface MediaHeaders {
  /** Чем отдаём на самом деле, а не что было написано в сообщении. */
  type: string;
  /** Готовое значение content-disposition вместе с именем файла. */
  disposition: string;
  /** true — покажется в окне; false — скачается. */
  inline: boolean;
}

/** Имя файла пришло от постороннего: путь и управляющие символы убираем. */
function cleanName(raw: string | null | undefined): string {
  const base = String(raw ?? '')
    .replace(/[/\\]+/g, ' ')
    .replace(/[\u0000-\u001f"]+/g, '')
    .trim();
  return (base || 'file').slice(0, 120);
}

/**
 * Заголовки отдачи вложения.
 *
 * force === 'attachment' скачивает даже картинку: кнопка «зберегти»
 * просит именно этого.
 */
export function mediaHeaders(
  rawMime: string | null | undefined,
  filename?: string | null,
  force?: 'attachment',
): MediaHeaders {
  // Параметры после точки с запятой (charset, boundary) отбрасываем:
  // решение принимается по типу, а не по тому, что к нему приписали.
  const mime = String(rawMime ?? '')
    .split(';')[0]!
    .trim()
    .toLowerCase();

  const inline = force !== 'attachment' && INLINE_SAFE.has(mime);
  const name = cleanName(filename);

  return {
    type: inline ? mime : 'application/octet-stream',
    disposition: `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
    inline,
  };
}
