import { describe, expect, it } from 'vitest';
import { mediaHeaders } from '../src/media.js';

/**
 * Вложение не должно уметь стать страницей.
 *
 * Файл приходит снаружи вместе с типом, и тип этот назначили не мы:
 * Telegram разрешает отправителю выставить mime_type каким угодно.
 * Кабинет забирает файл запросом с токеном и открывает локальную
 * копию — blob наследует тип ответа и наш домен. Файл с типом
 * text/html оттуда читает localStorage, где лежит тот самый токен, и
 * клиент из обычной переписки получает чужую учётную запись.
 */
describe('чем отдаём вложение', () => {
  it('картинка остаётся картинкой и показывается в окне', () => {
    const h = mediaHeaders('image/jpeg', 'photo.jpg');
    expect(h.type).toBe('image/jpeg');
    expect(h.inline).toBe(true);
    expect(h.disposition.startsWith('inline')).toBe(true);
  });

  /* Нейтральный тип и nosniff рядом — пара: без второго браузер
     додумывает тип по содержимому и открывает тот же html. */
  it('html становится файлом, а не страницей', () => {
    const h = mediaHeaders('text/html', 'invoice.html');
    expect(h.type).toBe('application/octet-stream');
    expect(h.inline).toBe(false);
    expect(h.disposition.startsWith('attachment')).toBe(true);
  });

  /* Та самая причина, по которой здесь список, а не правило
     «начинается с image/»: SVG — документ со скриптом, и именно через
     него эту дыру обычно и проходят. */
  it('SVG не считается картинкой', () => {
    const h = mediaHeaders('image/svg+xml', 'logo.svg');
    expect(h.type).toBe('application/octet-stream');
    expect(h.inline).toBe(false);
  });

  it('и его не спасают ни регистр, ни приписка charset', () => {
    expect(mediaHeaders('IMAGE/SVG+XML', 'a.svg').inline).toBe(false);
    expect(mediaHeaders('text/html; charset=utf-8', 'a.htm').inline).toBe(false);
    // А честной картинке приписка не мешает.
    expect(mediaHeaders('image/png; name=x', 'a.png').type).toBe('image/png');
  });

  it('неизвестный тип скачивается, а не показывается', () => {
    expect(mediaHeaders('application/x-newfangled', 'x').inline).toBe(false);
    expect(mediaHeaders(null, 'x').inline).toBe(false);
    expect(mediaHeaders('', 'x').inline).toBe(false);
  });

  /* Кнопка «зберегти» просит скачивание даже у картинки. */
  it('скачивание можно потребовать явно', () => {
    const h = mediaHeaders('image/png', 'photo.png', 'attachment');
    expect(h.inline).toBe(false);
    expect(h.type).toBe('application/octet-stream');
  });

  /* Имя файла пришло от постороннего и попадает в заголовок: путь,
     управляющие символы и кавычка из него убираются. */
  it('имя файла не ломает заголовок', () => {
    const h = mediaHeaders('text/html', '../../etc/passwd');
    expect(h.disposition).not.toContain('..%2F..');
    expect(h.disposition).toContain("filename*=UTF-8''");
    expect(mediaHeaders('text/html', '').disposition).toContain('file');
  });
});

describe('места, где файл уходит наружу', () => {
  /* Проверка стоит в одном месте не ради красоты: четыре ручки отдают
     файлы, и забыть её в одной — значит не починить ничего. */
  it('все отдачи файлов идут через общий расчёт', async () => {
    const { readFileSync } = await import('node:fs');
    const main = readFileSync(new URL('../../../apps/api/src/main.ts', import.meta.url), 'utf8');
    const webchat = readFileSync(new URL('../../../apps/api/src/webchat.ts', import.meta.url), 'utf8');

    // Вложение переписки, вложение шаблона, аватар, окно чата на сайте.
    expect((main.match(/mediaHeaders\(/g) ?? []).length).toBe(3);
    expect((webchat.match(/mediaHeaders\(/g) ?? []).length).toBe(1);

    // И ни одна из них не отдаёт присланный тип напрямую.
    expect(main).not.toContain('.type(att.mime ?? obj.contentType)');
    expect(main).not.toContain(".type(file.contentType || 'image/jpeg')");
    expect(webchat).not.toContain('.type(att.mime ?? obj.contentType)');
  });
});
