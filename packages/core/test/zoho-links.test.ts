import { describe, expect, it } from 'vitest';
import { zohoRecordUrl, convertedContactId } from '../src/zoho-links.js';

/**
 * Неверная ссылка в карточке клиента хуже её отсутствия: оператор
 * нажимает при клиенте и попадает на страницу ошибки. Поэтому здесь
 * проверяется в первую очередь то, когда ссылки быть не должно.
 */
describe('ссылка на карточку Zoho', () => {
  it('европейская зона: адрес интерфейса отличается от адреса API', () => {
    expect(zohoRecordUrl('https://www.zohoapis.eu', 'Contacts', '554123000')).toBe(
      'https://crm.zoho.eu/crm/tab/Contacts/554123000',
    );
  });

  it('канадская зона: интерфейс на zohocloud, а не на zoho', () => {
    expect(zohoRecordUrl('https://www.zohoapis.ca', 'Leads', '77')).toBe(
      'https://crm.zohocloud.ca/crm/tab/Leads/77',
    );
  });

  it('без связи с CRM ссылки нет', () => {
    expect(zohoRecordUrl('https://www.zohoapis.eu', null, null)).toBeNull();
    expect(zohoRecordUrl(null, 'Contacts', '1')).toBeNull();
  });

  it('неизвестная зона не превращается в догадку', () => {
    expect(zohoRecordUrl('https://api.example.com', 'Contacts', '1')).toBeNull();
  });

  it('мусор в модуле и номере записи не попадает в адрес', () => {
    expect(zohoRecordUrl('https://www.zohoapis.eu', '../../etc', '1')).toBeNull();
    expect(zohoRecordUrl('https://www.zohoapis.eu', 'Contacts', '1 OR 1=1')).toBeNull();
  });

  it('хвостовой слэш в адресе API не ломает ссылку', () => {
    expect(zohoRecordUrl('https://www.zohoapis.eu/', 'Contacts', '5')).toBe(
      'https://crm.zoho.eu/crm/tab/Contacts/5',
    );
  });
});

/**
 * Лид, которого сконвертировали в Zoho.
 *
 * Поля называются по-разному в разных версиях API, и угадывать версию
 * по номеру в адресе — худший способ узнать правду.
 */
describe('контакт из сконвертированного лида', () => {
  it('новое поле Converted_Contact', () => {
    expect(convertedContactId({
      Converted__s: true,
      Converted_Contact: { name: 'Костя', id: '1024137000038090615' },
      Converted_Account: { name: 'тест', id: '1024137000038090614' },
    })).toBe('1024137000038090615');
  });

  it('старое служебное поле тоже понимаем', () => {
    expect(convertedContactId({ $converted: true, $converted_detail: { contact: '777' } })).toBe('777');
    expect(convertedContactId({ $converted: true, $converted_detail: { contact_id: '778' } })).toBe('778');
  });

  it('несконвертированный лид — это не ошибка, а «ещё нет»', () => {
    expect(convertedContactId({ Converted__s: false, Converted_Contact: { id: '1' } })).toBeNull();
    expect(convertedContactId({})).toBeNull();
    expect(convertedContactId(null)).toBeNull();
  });

  it('сконвертирован, но контакта нет — сделка без контакта бывает', () => {
    expect(convertedContactId({ Converted__s: true, Converted_Account: { id: '5' } })).toBeNull();
    expect(convertedContactId({ Converted__s: true, Converted_Contact: { id: 'не число' } })).toBeNull();
  });
});
