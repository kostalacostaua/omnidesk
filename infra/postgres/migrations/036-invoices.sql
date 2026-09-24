-- Миграция 036 — счета, курс НБУ и реквизиты.
--
-- Оплату до сих пор вносили постфактум: пришли деньги — записали. Но
-- сначала клиенту выставляют счёт, и именно он определяет сумму, валюту
-- и курс. Счёт в долларах всё равно оплачивается гривной, поэтому курс
-- фиксируется в самом счёте: завтра он будет другим, а сумма в уже
-- выставленном счёте меняться не должна.
--
-- Реквизиты продавца и сквозная нумерация лежат в одной строке
-- настроек: счета выставляет один человек от одного лица, и заводить
-- ради этого справочник — значит усложнять то, чего пока нет.
--
-- Номер выдаётся счётчиком в настройках, а не запросом «максимум по
-- таблице»: счета лежат под RLS, и максимум виден только внутри одной
-- организации — нумерация разъехалась бы между клиентами.
--
-- Идемпотентна.

BEGIN;

-- Реквизиты и нумерация. Одна строка, id = 1: второй продавец здесь
-- не предусмотрен, и проверка это сторожит.
CREATE TABLE IF NOT EXISTS platform_settings (
  id             smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  seller_name    text NOT NULL DEFAULT '',
  seller_tax_id  text NOT NULL DEFAULT '',
  seller_iban    text NOT NULL DEFAULT '',
  seller_bank    text NOT NULL DEFAULT '',
  seller_address text NOT NULL DEFAULT '',
  seller_note    text NOT NULL DEFAULT '',
  invoice_prefix text NOT NULL DEFAULT '',
  invoice_seq    int  NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Курсы НБУ. Справочник публичных чисел: тенанта здесь нет и быть не
-- может, поэтому и RLS не нужен. Кэш нужен не ради скорости, а ради
-- того, чтобы не ходить в чужой сервис на каждое открытие страницы.
CREATE TABLE IF NOT EXISTS nbu_rates (
  day        date NOT NULL,
  code       text NOT NULL,
  rate       numeric(12,4) NOT NULL CHECK (rate > 0),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, code)
);

CREATE TABLE IF NOT EXISTS platform_invoices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number       text NOT NULL,
  issued_on    date NOT NULL DEFAULT current_date,
  due_on       date,
  amount       numeric(12,2) NOT NULL CHECK (amount > 0),
  currency     text NOT NULL DEFAULT 'UAH',
  -- Курс на день выставления и день, за который он объявлен: на
  -- выходные курса нет, и в счёте должно стоять честное «курс на
  -- пятницу», а не выдуманное воскресенье.
  rate         numeric(12,4) NOT NULL DEFAULT 1 CHECK (rate > 0),
  rate_day     date,
  rate_source  text NOT NULL DEFAULT 'nbu',
  amount_uah   numeric(12,2) NOT NULL DEFAULT 0,
  period_start date,
  period_end   date,
  subject      text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'issued'
               CHECK (status IN ('issued','paid','void')),
  paid_at      timestamptz,
  created_by   text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now()
);
SELECT apply_tenant_rls('platform_invoices');

CREATE INDEX IF NOT EXISTS platform_invoices_tenant_idx
  ON platform_invoices (tenant_id, issued_on DESC);
CREATE UNIQUE INDEX IF NOT EXISTS platform_invoices_number_idx
  ON platform_invoices (number);

-- Оплата по счёту. Ссылка необязательна: деньги могли прийти и без
-- счёта, и терять такую запись из-за отсутствия счёта незачем.
ALTER TABLE platform_payments
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES platform_invoices(id) ON DELETE SET NULL;

COMMIT;
