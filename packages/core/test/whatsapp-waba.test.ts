import { describe, expect, it } from 'vitest';
import { wabaFromDebug } from '../src/whatsapp.js';

/**
 * Идентификатор аккаунта WhatsApp Business достаётся из проверки токена:
 * у номера такого поля нет. Ошибка здесь не выглядит ошибкой — канал
 * подключается, отправка работает, а входящие просто не приходят. Найти
 * это без подсказки почти невозможно, поэтому разбор проверяется отдельно.
 */

describe('поиск аккаунта по токену', () => {
  it('берётся из права на управление аккаунтом', () => {
    const waba = wabaFromDebug({
      data: {
        granular_scopes: [
          { scope: 'whatsapp_business_management', target_ids: ['102030405060708'] },
        ],
      },
    });
    expect(waba).toBe('102030405060708');
  });

  it('если управления нет, годится право на отправку', () => {
    const waba = wabaFromDebug({
      data: {
        granular_scopes: [
          { scope: 'whatsapp_business_messaging', target_ids: ['900900900'] },
        ],
      },
    });
    expect(waba).toBe('900900900');
  });

  it('право без объектов не считается за аккаунт', () => {
    // Так выглядит токен, которому право выдали, но доступ к самому
    // аккаунту забыли: подписывать нечего, и притворяться нельзя.
    expect(
      wabaFromDebug({
        data: { granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: [] }] },
      }),
    ).toBeNull();
  });

  it('чужие права игнорируются', () => {
    expect(
      wabaFromDebug({
        data: {
          granular_scopes: [
            { scope: 'pages_messaging', target_ids: ['555'] },
            { scope: 'business_management', target_ids: ['777'] },
          ],
        },
      }),
    ).toBeNull();
  });

  it('пустой ответ не роняет разбор', () => {
    expect(wabaFromDebug({})).toBeNull();
    expect(wabaFromDebug({ data: {} })).toBeNull();
  });
});
