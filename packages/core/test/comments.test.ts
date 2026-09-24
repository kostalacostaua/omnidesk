import { describe, expect, it } from 'vitest';
import {
  facebookPostUrl,
  isCommentChannel,
  normalizeComments,
  splitCommentPayload,
} from '../src/comments.js';

const ctx = { tenantId: 't1', channelId: 'ch1' };

/** Пачка Facebook из документации: поле feed, элемент comment. */
function fbPayload(value: Record<string, unknown>) {
  return {
    object: 'page',
    entry: [{ id: 'PAGE1', time: 1_700_000_000_000, changes: [{ field: 'feed', value }] }],
  };
}

const fbComment = {
  item: 'comment',
  verb: 'add',
  comment_id: 'PAGE1_C1',
  post_id: '111_222',
  parent_id: '111_222',
  from: { id: 'USER1', name: 'Оксана Мельник' },
  message: 'Скільки коштує?',
  created_time: 1_700_000_000,
};

/** Пачка Instagram при входе через Facebook: поле comments. */
function igPayload(value: Record<string, unknown>) {
  return {
    object: 'instagram',
    entry: [{ id: 'IG1', time: 1_700_000_000_000, changes: [{ field: 'comments', value }] }],
  };
}

describe('разбор пачки комментариев', () => {
  it('комментарий Facebook попадает в события', () => {
    const [entry] = splitCommentPayload(fbPayload(fbComment));
    expect(entry?.channelType).toBe('messenger_comments');
    expect(entry?.channelExternalId).toBe('PAGE1');
    expect(entry?.events).toHaveLength(1);
    expect(entry?.events[0]).toMatchObject({
      commentId: 'PAGE1_C1',
      postId: '111_222',
      authorId: 'USER1',
      authorName: 'Оксана Мельник',
      text: 'Скільки коштує?',
    });
  });

  it('время берётся из created_time в секундах', () => {
    const [entry] = splitCommentPayload(fbPayload(fbComment));
    expect(entry?.events[0]?.at.toISOString()).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it('родителем считается комментарий, а не сам пост', () => {
    const [top] = splitCommentPayload(fbPayload(fbComment));
    expect(top?.events[0]?.parentId).toBeUndefined();

    const [reply] = splitCommentPayload(
      fbPayload({ ...fbComment, comment_id: 'PAGE1_C2', parent_id: 'PAGE1_C1' }),
    );
    expect(reply?.events[0]?.parentId).toBe('PAGE1_C1');
  });

  it('лайки, репосты и посты страницы не комментарии', () => {
    for (const item of ['status', 'reaction', 'share', 'post', 'photo']) {
      expect(splitCommentPayload(fbPayload({ ...fbComment, item }))).toEqual([]);
    }
  });

  it('правка и удаление комментария в ленту не попадают', () => {
    for (const verb of ['edited', 'edit', 'remove', 'hide']) {
      expect(splitCommentPayload(fbPayload({ ...fbComment, verb }))).toEqual([]);
    }
  });

  it('комментарий Instagram попадает в события', () => {
    const [entry] = splitCommentPayload(
      igPayload({
        from: { id: 'IGU1', username: 'oksana' },
        comment_id: 'IGC1',
        text: 'А доставка є?',
        media: { id: 'MEDIA1', media_product_type: 'FEED' },
      }),
    );
    expect(entry?.channelType).toBe('instagram_comments');
    expect(entry?.events[0]).toMatchObject({
      commentId: 'IGC1',
      postId: 'MEDIA1',
      authorId: 'IGU1',
      authorUsername: 'oksana',
      text: 'А доставка є?',
    });
  });

  it('вход через Instagram кладёт идентификатор в id — тоже понимаем', () => {
    const [entry] = splitCommentPayload(
      igPayload({ id: 'IGC2', from: { id: 'IGU1', username: 'oksana' }, text: 'ку' }),
    );
    expect(entry?.events[0]?.commentId).toBe('IGC2');
  });

  it('комментарии под прямым эфиром — тот же канал', () => {
    const p = igPayload({ id: 'IGC3', from: { id: 'IGU1' }, text: 'привіт' });
    p.entry[0]!.changes[0]!.field = 'live_comments';
    expect(splitCommentPayload(p)[0]?.events).toHaveLength(1);
  });

  it('чужие поля и мусор не ломают разбор', () => {
    expect(splitCommentPayload(undefined)).toEqual([]);
    expect(splitCommentPayload({ object: 'whatsapp_business_account', entry: [] })).toEqual([]);
    expect(splitCommentPayload({ object: 'page', entry: [{ id: 'P', changes: [{ field: 'name' }] }] })).toEqual([]);
    expect(splitCommentPayload(fbPayload({ item: 'comment', verb: 'add' }))).toEqual([]);
  });
});

describe('комментарии в ленту', () => {
  it('комментарий клиента становится входящим сообщением', () => {
    const [entry] = splitCommentPayload(fbPayload(fbComment));
    const [msg] = normalizeComments(ctx, entry!, ['PAGE1']);
    expect(msg).toMatchObject({
      channelType: 'messenger_comments',
      externalId: 'PAGE1_C1',
      peerId: 'USER1',
      direction: 'in',
      senderType: 'customer',
    });
    expect(msg?.content.text).toBe('Скільки коштує?');
    expect(msg?.content.comment).toMatchObject({
      commentId: 'PAGE1_C1',
      postId: '111_222',
      url: 'https://www.facebook.com/111/posts/222',
    });
  });

  it('свой же комментарий в ленту не попадает', () => {
    const [entry] = splitCommentPayload(
      fbPayload({ ...fbComment, from: { id: 'PAGE1', name: 'Наша сторінка' } }),
    );
    expect(normalizeComments(ctx, entry!, ['PAGE1'])).toEqual([]);
  });

  it('фото и видео из комментария становятся вложениями', () => {
    const [entry] = splitCommentPayload(
      fbPayload({ ...fbComment, photo: 'https://scontent/p.jpg', video: 'https://video/v.mp4' }),
    );
    const [msg] = normalizeComments(ctx, entry!, ['PAGE1']);
    expect(msg?.content.attachments).toEqual([
      { type: 'image', externalId: 'https://scontent/p.jpg' },
      { type: 'video', externalId: 'https://video/v.mp4' },
    ]);
  });

  it('комментарий без текста и вложений всё равно виден', () => {
    const [entry] = splitCommentPayload(fbPayload({ ...fbComment, message: undefined }));
    const [msg] = normalizeComments(ctx, entry!, ['PAGE1']);
    expect(msg?.content.text).toBeTruthy();
  });

  it('имя берётся из вебхука, а профиль не запрашивается', () => {
    const [fb] = splitCommentPayload(fbPayload(fbComment));
    expect(normalizeComments(ctx, fb!, ['PAGE1'])[0]?.peerProfile.name).toBe('Оксана Мельник');

    const [ig] = splitCommentPayload(
      igPayload({ comment_id: 'IGC1', from: { id: 'IGU1', username: 'oksana' }, text: 'ку' }),
    );
    const msg = normalizeComments(ctx, ig!, ['IG1'])[0];
    expect(msg?.peerProfile.username).toBe('oksana');
    expect(msg?.peerProfile.name).toBe('@oksana');
  });

  it('у Instagram ссылки на пост нет — и выдуманной тоже', () => {
    const [ig] = splitCommentPayload(
      igPayload({ comment_id: 'IGC1', from: { id: 'IGU1' }, text: 'ку', media: { id: 'M1' } }),
    );
    const msg = normalizeComments(ctx, ig!, ['IG1'])[0];
    expect(msg?.content.comment?.postId).toBe('M1');
    expect(msg?.content.comment?.url).toBeUndefined();
  });
});

describe('ссылка на пост Facebook', () => {
  it('собирается из составного идентификатора', () => {
    expect(facebookPostUrl('111_222')).toBe('https://www.facebook.com/111/posts/222');
  });

  it('непонятная форма — лучше без ссылки', () => {
    expect(facebookPostUrl(undefined)).toBeNull();
    expect(facebookPostUrl('111')).toBeNull();
    expect(facebookPostUrl('111_222_333')).toBeNull();
    expect(facebookPostUrl('abc_def')).toBeNull();
  });
});

describe('признак канала комментариев', () => {
  it('отличает комментарии от личных сообщений', () => {
    expect(isCommentChannel('messenger_comments')).toBe(true);
    expect(isCommentChannel('instagram_comments')).toBe(true);
    expect(isCommentChannel('messenger')).toBe(false);
    expect(isCommentChannel('instagram')).toBe(false);
  });
});
