import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Чужая CRM не привязывается к нашей компании.
 *
 * state генерировался и выбрасывался: randomUUID() никуда не
 * записывался, а callback его не читал вовсе. Установка от этого
 * переставала быть чьей-то — посторонний проходил разрешение со СВОИМ
 * Pipedrive, получал в адресе номер установки и присылал жертве ссылку
 * вида app.rozmovio.com/app#pipedrive=<номер>. Кабинет привязывал её
 * сам, без единого вопроса, и с этой минуты все сделки, имена и
 * телефоны клиентов жертвы уезжали в CRM постороннего. Одно нажатие,
 * и ни одной ошибки в правах.
 *
 * В Zoho это было сделано правильно с самого начала — подписанный
 * state. Здесь то же самое, а не третий способ: третий стал бы
 * четвёртым местом, где однажды ошибутся.
 */
const SRC = readFileSync(new URL('../src/crm.ts', import.meta.url), 'utf8');
const ZOHO = readFileSync(new URL('../src/zoho.ts', import.meta.url), 'utf8');

describe('подпись возврата из Pipedrive', () => {
  it('state подписывается и несёт тенанта с человеком', () => {
    expect(SRC).toContain('function signState(');
    expect(SRC).toContain('signState({ t: a.tenantId, u: a.userId, exp: Date.now() + 15 * 60_000 })');
  });

  it('случайного числа на его месте не осталось', () => {
    const start = (() => {
      const from = SRC.indexOf("'/settings/pipedrive/start'");
      expect(from).toBeGreaterThan(0);
      return SRC.slice(from, from + 500);
    })();
    expect(start).not.toContain('randomUUID()');
  });

  it('возврат без подписи не идёт дальше обмена', () => {
    const cb = (() => {
      const from = SRC.indexOf("'/pipedrive/callback'");
      expect(from).toBeGreaterThan(0);
      return SRC.slice(from, from + 1600);
    })();
    const guard = cb.indexOf('readState(req.query.state');
    const exchange = cb.indexOf('pipedriveExchange(');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(exchange);
    expect(cb).toContain('pipedrive-error=state');
  });

  /* Подпись сверяется посимвольно за одинаковое время: сравнение по
     != раздаёт её по букве тому, кто готов ждать. */
  it('подпись сверяется без утечки по времени', () => {
    expect(SRC).toContain('timingSafeEqual(a, b)');
  });

  it('делает это тем же способом, что и Zoho', () => {
    expect(ZOHO).toContain('function readState(');
    expect(SRC).toContain('function readState(');
  });
});

describe('привязка установки', () => {
  /* Между callback и attach лежит адресная строка, куда номер можно
     вписать рукой. Поэтому проверка стоит в обоих местах. */
  it('номер установки помнит, чей он', () => {
    expect(SRC).toContain("JSON.stringify({ tokens, t: st.t, u: st.u })");
  });

  it('к чужой компании не привязывается', () => {
    expect(SRC).toContain("if (held.t !== a.tenantId)");
    expect(SRC).toContain("error: 'install_not_yours'");
  });

  /* Чужой ключ не наш, и гасить его по предъявлении чужого номера
     значит дать посторонним способ ломать чужую установку. */
  it('чужую установку не стирает', () => {
    const attach = (() => {
      const from = SRC.indexOf("'/settings/pipedrive/attach'");
      return SRC.slice(from, from + 1800);
    })();
    const check = attach.indexOf('held.t !== a.tenantId');
    const del = attach.indexOf('redis.del(');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(del);
  });
});
