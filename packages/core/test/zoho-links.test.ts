import { describe, expect, it } from 'vitest';
import { zohoRecordUrl } from '../src/zoho-links.js';

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
