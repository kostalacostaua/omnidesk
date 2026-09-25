/**
 * Сумма прописью.
 *
 * В украинском счёте сумма пишется дважды: цифрами и словами. Это не
 * украшение, а защита от дописанной цифры — и первое, на что смотрит
 * бухгалтер, когда сверяет счёт с платёжкой. Счёт без прописи выглядит
 * самодельным, и его возвращают.
 *
 * Здесь только украинский: счета по безналу выставляет украинский ФОП
 * украинским же организациям. Понадобится второй язык — будет второй
 * словарь, но выдумывать его заранее не станем.
 */

const ONES = [
  '', 'один', 'два', 'три', 'чотири', "п'ять", 'шість', 'сім', 'вісім', "дев'ять",
  'десять', 'одинадцять', 'дванадцять', 'тринадцять', 'чотирнадцять', "п'ятнадцять",
  'шістнадцять', 'сімнадцять', 'вісімнадцять', "дев'ятнадцять",
];
const ONES_F = [...ONES];
ONES_F[1] = 'одна';
ONES_F[2] = 'дві';

const TENS = [
  '', '', 'двадцять', 'тридцять', 'сорок', "п'ятдесят", 'шістдесят', 'сімдесят',
  'вісімдесят', "дев'яносто",
];
const HUNDREDS = [
  '', 'сто', 'двісті', 'триста', 'чотириста', "п'ятсот", 'шістсот', 'сімсот',
  'вісімсот', "дев'ятсот",
];

/** Форма слова при числе: 1 гривня, 2 гривні, 5 гривень. */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.trunc(n));
  const last2 = abs % 100;
  const last = abs % 10;
  if (last2 >= 11 && last2 <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

/** Три разряда словами. Женский род нужен тысячам и гривне. */
function triple(n: number, female: boolean): string[] {
  const out: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) out.push(HUNDREDS[h]!);
  if (rest < 20) {
    if (rest) out.push((female ? ONES_F : ONES)[rest]!);
  } else {
    out.push(TENS[Math.floor(rest / 10)]!);
    const one = rest % 10;
    if (one) out.push((female ? ONES_F : ONES)[one]!);
  }
  return out;
}

/**
 * Целое число словами.
 *
 * Ноль называем словом: «нуль гривень» в счёте не встречается, но
 * функция, молчащая на ноль, однажды отдаст пустую строку в поле, где
 * её никто не ждёт.
 */
export function numberWords(value: number, female = false): string {
  let n = Math.floor(Math.abs(value));
  if (!n) return 'нуль';

  const groups: Array<{ value: number; female: boolean; one: string; few: string; many: string }> = [
    { value: 1_000_000_000, female: false, one: 'мільярд', few: 'мільярди', many: 'мільярдів' },
    { value: 1_000_000, female: false, one: 'мільйон', few: 'мільйони', many: 'мільйонів' },
    { value: 1_000, female: true, one: 'тисяча', few: 'тисячі', many: 'тисяч' },
  ];

  const out: string[] = [];
  for (const g of groups) {
    const count = Math.floor(n / g.value);
    if (!count) continue;
    n -= count * g.value;
    out.push(...triple(count, g.female), plural(count, g.one, g.few, g.many));
  }
  if (n) out.push(...triple(n, female));
  return out.filter(Boolean).join(' ');
}

/** Название валюты в трёх формах: для числа 1, 2 и 5. */
const CURRENCY: Record<string, { one: string; few: string; many: string; female: boolean;
  centOne: string; centFew: string; centMany: string; centFemale: boolean }> = {
  UAH: {
    one: 'гривня', few: 'гривні', many: 'гривень', female: true,
    centOne: 'копійка', centFew: 'копійки', centMany: 'копійок', centFemale: true,
  },
  USD: {
    one: 'долар', few: 'долари', many: 'доларів', female: false,
    centOne: 'цент', centFew: 'центи', centMany: 'центів', centFemale: false,
  },
  EUR: {
    one: 'євро', few: 'євро', many: 'євро', female: false,
    centOne: 'цент', centFew: 'центи', centMany: 'центів', centFemale: false,
  },
};

/**
 * Сумма прописью с копейками цифрами: «шістдесят вісім тисяч сорок
 * гривень 00 копійок».
 *
 * Копейки цифрами, а не словами, — так печатают все бухгалтерские
 * программы, и так их проще сверять глазом с цифровой суммой рядом.
 */
export function moneyWords(amount: number | string, currency = 'UAH'): string {
  const n = Number(String(amount ?? '0').replace(',', '.'));
  const value = Number.isFinite(n) ? Math.abs(n) : 0;
  // Через копейки, а не через дробь: 0.1 + 0.2 в двоичной дроби даёт
  // не 0.3, и на сумме счёта это однажды станет видно.
  const cents = Math.round(value * 100);
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;

  const c = CURRENCY[currency.toUpperCase()] ?? CURRENCY['UAH']!;
  const head = numberWords(whole, c.female);
  const unit = plural(whole, c.one, c.few, c.many);
  const centUnit = plural(rest, c.centOne, c.centFew, c.centMany);
  return `${head} ${unit} ${String(rest).padStart(2, '0')} ${centUnit}`;
}
