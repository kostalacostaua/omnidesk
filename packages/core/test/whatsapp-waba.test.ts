import { describe, expect, it } from 'vitest';
import { canSendWhatsapp, wabaFromDebug } from '../src/whatsapp.js';

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

/**
 * Право на отправку отмечают галочкой рядом с правом на управление, и
 * отметить одну вместо двух — обычное дело. Проявляется это врозь и
 * поздно: входящие идут, исходящие отказываются. Поэтому проверяется
 * заранее.
 */
describe('право на отправку', () => {
  it('есть — отправка разрешена', () => {
    expect(
      canSendWhatsapp({
        data: { scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'] },
      }),
    ).toBe(true);
  });

  it('нет — подключать нельзя, это тихая поломка', () => {
    expect(canSendWhatsapp({ data: { scopes: ['whatsapp_business_management'] } })).toBe(false);
  });

  it('список прав пуст — не придираемся', () => {
    // У части токенов Graph списка не отдаёт. Запрещать подключение
    // из-за отсутствия сведений — значит ломать рабочий случай.
    expect(canSendWhatsapp({ data: { scopes: [] } })).toBe(true);
    expect(canSendWhatsapp({ data: {} })).toBe(true);
    expect(canSendWhatsapp({})).toBe(true);
  });
});
