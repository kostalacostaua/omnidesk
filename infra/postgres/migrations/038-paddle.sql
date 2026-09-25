-- Оплата подписки через Paddle.
--
-- Идентификаторы клиента и подписки храним у арендатора: по подписке
-- приходят события, по клиенту открывается его кабинет оплаты. Оба
-- нужны именно здесь, а не в отдельной таблице: подписка у клиента
-- одна, и вторая таблица ради трёх полей только добавила бы join.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS paddle_customer_id     text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS paddle_subscription_id text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS paddle_status          text;

-- Одна подписка — один арендатор. Без этого перепутанный tenant_id в
-- custom_data тихо привязал бы чужую оплату ко второму клиенту.
CREATE UNIQUE INDEX IF NOT EXISTS tenants_paddle_sub
  ON tenants (paddle_subscription_id) WHERE paddle_subscription_id IS NOT NULL;

-- Карта «тариф → цена в Paddle». Лежит рядом с ценами тарифов, которые
-- владелец и так задаёт в своей панели.
ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS paddle_prices jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Применённые события.
--
-- Paddle повторяет доставку, пока не получит 200, и повторяет её же
-- при своих сбоях. Без этой таблицы один и тот же «подписка отменена»
-- применялся бы дважды — во второй раз уже поверх новой оплаты.
CREATE TABLE IF NOT EXISTS paddle_events (
  id          text PRIMARY KEY,
  event_type  text NOT NULL,
  tenant_id   uuid,
  received_at timestamptz NOT NULL DEFAULT now()
);
