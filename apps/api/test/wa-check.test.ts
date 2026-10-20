import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { requiredLevel } from '../src/roles.js';

/**
 * Почему не уходит из WhatsApp.
 *
 * Meta отвечает на отказ одной фразой — «нет разрешения отправлять от
 * имени этого аккаунта», — и под ней лежит полдюжины разных поломок:
 * маркер не того приложения, номер в чужом аккаунте, номер остался на
 * On-Premises, аккаунт под ограничением. Снаружи они неотличимы, а
 * чинятся по-разному, и человек перебирает их наугад.
 *
 * Маркер лежит у нас — значит спросить Meta можем мы сами, а не
 * просить человека ходить в отладчик и сверять строки глазами.
 */
const SETTINGS = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');
const UI = readFileSync(new URL('../src/ui.ts', import.meta.url), 'utf8');

const route = (() => {
  const from = SETTINGS.indexOf("'/settings/channels/whatsapp/:id/check'");
  expect(from).toBeGreaterThan(0);
  return SETTINGS.slice(from, SETTINGS.indexOf('\n  );', from));
})();

describe('что проверка спрашивает', () => {
  it('чей это маркер, а не только что он умеет', () => {
    expect(route).toContain('debug_token');
    expect(route).toContain('appId: d?.app_id');
    expect(route).toContain('appName: d?.application');
  });

  /* Номер, оставшийся на On-Premises, через Cloud API не отправляет
     никогда, и Meta отвечает на это тем же кодом 200. Глазами этого
     не видно нигде. */
  it('через Cloud API ли работает номер', () => {
    expect(route).toContain('platform_type');
    expect(route).toContain("num.platform_type !== 'CLOUD_API'");
    expect(route).toContain("problems.push('not_cloud_api')");
  });

  it('тому ли аккаунту принадлежит номер', () => {
    expect(route).toContain('whatsapp_business_account{id,name}');
    expect(route).toContain("realWaba !== storedWaba");
    expect(route).toContain("problems.push('waba_mismatch')");
  });

  it('виден ли нам сам аккаунт и не под ограничением ли он', () => {
    expect(route).toContain('account_review_status');
    expect(route).toContain('business_verification_status');
  });
});

describe('чего проверка не делает', () => {
  /* Маркер не покидает сервер ни целиком, ни частью: наружу идёт
     только то, что он говорит о себе. */
  it('не отдаёт маркер наружу', () => {
    expect(route).not.toContain('pageToken: creds.pageToken');
    expect(route).toContain("out['token'] = {");
    const payload = route.slice(route.indexOf("out['token'] = {"), route.indexOf('} catch'));
    expect(payload).not.toContain('creds.pageToken');
  });

  /* Одна неудача не должна глотать остальные ответы: номер мог не
     прочитаться, а аккаунт — прочитаться, и это уже половина
     ответа. */
  it('не падает на первой же ошибке', () => {
    expect((route.match(/catch \(err\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe('кто может проверять', () => {
  it('только администратор', () => {
    expect(requiredLevel('POST', '/settings/channels/whatsapp/abc/check')).toBe('admin');
  });
});

describe('что видит человек', () => {
  /* Тот, кто дошёл до этого экрана, уже устал. Коды ему ничего не
     скажут. */
  it('поломки названы словами, а не кодами', () => {
    expect(UI).toContain('var WA_PROBLEMS = {');
    expect(UI).toContain('On-Premises');
    expect(UI).toContain('whatsapp_business_messaging');
  });

  it('кнопка есть только у официального WhatsApp', () => {
    const from = UI.indexOf('id="waCheck"');
    expect(from).toBeGreaterThan(0);
    expect(UI.slice(from - 700, from)).toContain("c.type === 'whatsapp'");
  });

  /* Когда отсюда всё выглядит целым, это тоже ответ — но честный:
     не «всё хорошо», а «отсюда не видно». */
  it('ничего не найдя, не объявляет, что всё в порядке', () => {
    const fn = UI.slice(UI.indexOf('function waCheck(id){'));
    expect(fn.slice(0, 3000)).toContain('Усе, що видно звідси, у порядку');
  });
});
