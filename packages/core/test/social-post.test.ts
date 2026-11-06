import { describe, expect, it } from 'vitest';
import { fetchSocialPost } from '../src/meta.js';

/**
 * Пост, под которым идёт разговор.
 *
 * Проверяется главное: у Facebook и Instagram поля называются
 * по-разному и не пересекаются ни одним именем. Запрос с чужим списком
 * полей Meta отклоняет целиком, и снаружи это выглядит как «поста нет»,
 * а не как ошибка в коде.
 */

/** Подставной fetch: запоминает адрес и отдаёт заготовленный ответ. */
function fakeFetch(body: unknown) {
  const calls: string[] = [];
  const impl = ((input: unknown) => {
    calls.push(String(input));
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('пост под комментарием', () => {
  it('у Facebook берёт message, permalink_url и created_time', async () => {
    const f = fakeFetch({
      message: 'Знижка на зимову колекцію до неділі',
      permalink_url: 'https://www.facebook.com/111/posts/222',
      created_time: '2026-11-05T10:00:00+0000',
      full_picture: 'https://cdn.example/pic.jpg',
    });

    const post = await fetchSocialPost('facebook', '111_222', 'TOKEN', { fetchImpl: f.impl });

    expect(post.postId).toBe('111_222');
    expect(post.text).toBe('Знижка на зимову колекцію до неділі');
    expect(post.permalink).toBe('https://www.facebook.com/111/posts/222');
    expect(post.picture).toBe('https://cdn.example/pic.jpg');
    expect(post.postedAt?.toISOString()).toBe('2026-11-05T10:00:00.000Z');

    // Список полей именно фейсбучный: caption и timestamp здесь не
    // спрашиваются, иначе Meta отклонит запрос целиком.
    expect(f.calls[0]).toContain('message');
    expect(f.calls[0]).toContain('permalink_url');
    expect(f.calls[0]).not.toContain('caption');
  });

  it('у Instagram берёт caption, permalink и timestamp', async () => {
    const f = fakeFetch({
      caption: 'Нова колекція вже в магазині',
      permalink: 'https://www.instagram.com/p/ABC123/',
      media_url: 'https://cdn.example/ig.jpg',
      timestamp: '2026-11-04T08:30:00+0000',
    });

    const post = await fetchSocialPost('instagram', '17900000000000000', 'TOKEN', {
      fetchImpl: f.impl,
    });

    expect(post.text).toBe('Нова колекція вже в магазині');
    expect(post.permalink).toBe('https://www.instagram.com/p/ABC123/');
    expect(post.picture).toBe('https://cdn.example/ig.jpg');
    expect(post.postedAt?.toISOString()).toBe('2026-11-04T08:30:00.000Z');

    expect(f.calls[0]).toContain('caption');
    expect(f.calls[0]).not.toContain('permalink_url');
  });

  it('у видео в Instagram картинку берёт из thumbnail_url', async () => {
    const f = fakeFetch({
      caption: 'Розпаковка',
      permalink: 'https://www.instagram.com/reel/XYZ/',
      thumbnail_url: 'https://cdn.example/thumb.jpg',
      timestamp: '2026-11-04T08:30:00+0000',
    });

    const post = await fetchSocialPost('instagram', '1790', 'TOKEN', { fetchImpl: f.impl });
    expect(post.picture).toBe('https://cdn.example/thumb.jpg');
  });

  it('пост без подписи — это пост, а не пустота', async () => {
    const f = fakeFetch({ permalink: 'https://www.instagram.com/p/NOCAP/' });

    const post = await fetchSocialPost('instagram', '1791', 'TOKEN', { fetchImpl: f.impl });

    // Текста нет, но ссылка есть: под картинкой без подписи
    // комментируют так же охотно, и показать такой пост всё равно надо.
    expect(post.text).toBeUndefined();
    expect(post.permalink).toBe('https://www.instagram.com/p/NOCAP/');
  });

  it('мусор во времени не превращается в дату', async () => {
    const f = fakeFetch({ message: 'Текст', created_time: 'позавчора' });

    const post = await fetchSocialPost('facebook', '1_2', 'TOKEN', { fetchImpl: f.impl });

    // Invalid Date в ленте хуже отсутствующей даты: он рисуется как
    // NaN и выглядит поломкой интерфейса.
    expect(post.postedAt).toBeUndefined();
    expect(post.text).toBe('Текст');
  });
});
