import { describe, expect, it } from 'vitest';
import { INBOX_HTML } from '../src/ui.js';

/**
 * Поле ответа принимает файл тремя путями: скрепкой, вставкой из
 * буфера и перетаскиванием. Проверяется здесь не то, что код написан,
 * а два условия, нарушение которых ломает работу молча.
 */

const script = (/<script>([\s\S]*)<\/script>/.exec(INBOX_HTML) ?? [])[1] ?? '';

describe('файл в поле ответа', () => {
  it('скрипт вообще нашёлся', () => {
    expect(script.length).toBeGreaterThan(10000);
  });

  /*
   * Самое опасное место. Обработчик вставки обязан отменять
   * стандартное поведение ТОЛЬКО когда в буфере оказался файл.
   * Переставь preventDefault выше проверки — и в поле перестанет
   * вставляться обычный текст: во всём кабинете, у всех, и без
   * единой ошибки в консоли.
   */
  it('вставка перехватывается только ради файла, не ради текста', () => {
    const body = /ta\.onpaste = function\(e\)\{([\s\S]*?)\n  \};/.exec(script)?.[1] ?? '';
    expect(body.length).toBeGreaterThan(100);
    const bail = body.indexOf('if (!f) return;');
    const stop = body.indexOf('e.preventDefault()');
    expect(bail).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(-1);
    expect(bail).toBeLessThan(stop);
  });

  /*
   * Предел в двадцать мегабайт стоял только у скрепки. Появились ещё
   * два входа — и про предел узнавали бы уже от сервера, после долгой
   * загрузки. Поэтому проверка живёт в одном месте, через которое
   * проходят все три.
   */
  it('все три входа ведут через одну проверку размера', () => {
    // Проверка стоит внутри takeFile, а не у каждого входа.
    const take = /function takeFile\(f\)\{([\s\S]*?)\n\}/.exec(script)?.[1] ?? '';
    expect(take.length).toBeGreaterThan(200);
    expect(take).toContain('20 * 1024 * 1024');

    for (const entry of [
      "el('file').onchange = function(){ takeFile(",
      'ta.onpaste = function(e)',
      "cbox.addEventListener('drop'",
    ]) {
      expect(script, entry).toContain(entry);
    }
    // Три входа плюс само объявление: ни один не ходит в обход.
    expect((script.match(/takeFile\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  /*
   * Ссылка на картинку для миниатюры живёт ровно столько же, сколько
   * сам файл. Забыли отпустить — и каждая вставка оставляет в памяти
   * ещё одну: за смену их набирается столько же, сколько снимков.
   */
  it('ссылка на миниатюру отпускается там же, где забывается файл', () => {
    expect(script).toContain('URL.revokeObjectURL(pendingUrl)');
    expect(/function dropPending\(\)\{[\s\S]*?pendingFile = null/.test(script)).toBe(true);

    /* Обнуление живёт только в объявлении переменной и в самом
       dropPending. Третье означало бы забытый файл со ссылкой,
       которую никто не отпустил. */
    const clears = script.match(/^\s*(?:var )?pendingFile = null/gm) ?? [];
    expect(clears).toHaveLength(2);
    expect(clears.filter((c) => c.includes('var'))).toHaveLength(1);
  });
});
