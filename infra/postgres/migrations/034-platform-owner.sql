-- Миграция 034 — панель владельца платформы: тариф, оплаты, журнал.
--
-- До сих пор об организациях не было известно ничего, кроме названия и
-- строки «plan». Продавать так нельзя: непонятно, кто зарегистрировался,
-- кто платит, до какого числа оплачено и сколько сообщений человек
-- пропустил через нас за месяц.
--
-- Оплаты и журнал входов лежат под тем же RLS, что и всё остальное, и
-- новых исключений здесь нет. Исключение из RLS в этой системе
-- оправдано ровно одним: таблица нужна ДО того, как тенант известен.
-- Здесь тенант известен всегда — панель смотрит на конкретную
-- организацию, — поэтому и читается всё в её контексте. Цена: сводка по
-- всем организациям собирается обходом, а не одним запросом. Это
-- сознательный размен: обход по сотне организаций стоит сотни дешёвых
-- запросов, а соединение, способное прочитать переписку всех клиентов
-- сразу, не появляется.
--
-- Идемпотентна.

BEGIN;

-- Тариф. Цена и дата оплаты живут у организации, а не в отдельной
-- таблице тарифов: тарифов пока нет как сущности, есть договорённость
-- с конкретным клиентом, и притворяться, что есть прайс, незачем.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS paid_until  date;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS price_month numeric(10,2);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS currency    text NOT NULL DEFAULT 'UAH';
-- Заметка владельца о клиенте: кто привёл, о чём договорились.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS note        text NOT NULL DEFAULT '';

-- Оплаты вносятся руками: платёжного шлюза пока нет, а знать, кто и
-- когда заплатил, надо уже сейчас. Период хранится датами, а не
-- «месяцем»: оплата за полгода — обычное дело.
CREATE TABLE IF NOT EXISTS platform_payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  amount        numeric(10,2) NOT NULL,
  currency      text NOT NULL DEFAULT 'UAH',
  period_start  date,
  period_end    date,
  method        text NOT NULL DEFAULT '',
  note          text NOT NULL DEFAULT '',
  -- Кто внёс: почта владельца платформы. Не ссылка на users —
  -- владелец платформы не пользователь этой организации.
  created_by    text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);
SELECT apply_tenant_rls('platform_payments');

CREATE INDEX IF NOT EXISTS platform_payments_tenant_idx
  ON platform_payments (tenant_id, created_at DESC);

-- Журнал действий владельца платформы в чужой организации.
--
-- Главное здесь — вход под клиентом. Такой вход обязан оставлять след:
-- иначе в переписке появляются ответы, которых никто из сотрудников
-- организации не писал, и объяснить их нечем.
CREATE TABLE IF NOT EXISTS admin_audit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_email   text NOT NULL,
  action        text NOT NULL,
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
SELECT apply_tenant_rls('admin_audit');

CREATE INDEX IF NOT EXISTS admin_audit_tenant_idx
  ON admin_audit (tenant_id, created_at DESC);

COMMIT;
