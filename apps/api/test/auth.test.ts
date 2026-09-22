import { describe, expect, it } from 'vitest';
import { slugFor } from '../src/auth-email.js';

describe('slug компании при регистрации', () => {
  it('транслитерирует кириллицу, а не выбрасывает её', () => {
    expect(slugFor('Тестова компанія')).toMatch(/^testova-kompaniya-/);
  });

  it('два клиента с одинаковым названием получают разные slug', () => {
    expect(slugFor('KL Systems')).not.toBe(slugFor('KL Systems'));
  });

  it('название из одних символов не ломает результат', () => {
    expect(slugFor('!!!')).toMatch(/^company-/);
  });

  it('длинное название обрезается, но остаётся читаемым', () => {
    const s = slugFor('Дуже довга назва компанії яка не поміщається у тридцять два символи');
    expect(s.length).toBeLessThan(45);
    expect(s.startsWith('duzhe-dovga')).toBe(true);
  });

  it('в slug нет символов, ломающих адрес', () => {
    expect(slugFor('ООО «Ромашка & Ко»')).toMatch(/^[a-z0-9-]+$/);
  });
});
