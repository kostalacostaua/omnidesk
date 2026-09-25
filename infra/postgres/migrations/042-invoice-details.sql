-- Реквизиты сторон в счёте.
--
-- Счёт по безналу — документ, который уходит в чужую бухгалтерию, и
-- там его сверяют по реквизитам, а не по названию. Пока у нас было
-- только имя организации, счёт выглядел запиской: «Платник: Ромашка».
-- Бухгалтер с такой бумагой не работает, и клиент возвращается с
-- просьбой переделать — иногда через неделю после выставления.
--
-- Поэтому реквизиты покупателя живут у организации: их вписывают один
-- раз, и дальше они подставляются сами. Реквизиты продавца одни на все
-- счета и лежат в настройках платформы; здесь к ним добавляется то,
-- без чего платёжное поручение не заполнить, — МФО банка, телефон и
-- кто подписывает.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS legal_name    text NOT NULL DEFAULT '',
  -- ЄДРПОУ для юрлица, РНОКПП для ФОП: поле одно, потому что в счёте
  -- оно стоит на одном месте и означает одно — код плательщика.
  ADD COLUMN IF NOT EXISTS tax_id        text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS vat_id        text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS legal_address text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bank_name     text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS iban          text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bank_code     text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS vat_payer     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS signer        text NOT NULL DEFAULT '';

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS seller_bank_code text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS seller_phone     text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS seller_signer    text NOT NULL DEFAULT '';

-- Отметка «клиент сказал, что заплатил».
--
-- Это не оплата: деньги приходят на счёт и отмечаются нами. Но между
-- «выставили» и «пришло» есть день-другой, и всё это время клиент
-- сидит и не знает, увидели мы его платёж или нет. Отметка закрывает
-- этот разрыв: он нажал, мы получили оповещение, он видит, что нажатие
-- дошло.
ALTER TABLE platform_invoices
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
