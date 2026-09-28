-- Миграция 049 — вебхуки: события наружу, к коду клиента.
--
-- Обратная сторона своего канала. Там клиент присылает нам сообщения,
-- здесь мы рассказываем его системе о том, что произошло у нас.
--
-- Две таблицы. Первая — подписка: адрес, секрет подписи и список
-- событий. Вторая — журнал попыток: без него отладка на стороне
-- клиента идёт вслепую, а разговор «вы не присылали» — «присылали»
-- нечем закончить.
--
-- Секрет и свой заголовок клиента лежат зашифрованными ключом
-- компании, как и все прочие учётные данные каналов: дамп базы не
-- должен давать возможность слать клиенту события от нашего имени.
--
-- Журнал держится коротким — полсотни последних попыток на вебхук, —
-- и чистится при записи новой. Это не архив, а то, что человек
-- смотрит, когда чинит приём у себя; хранить месяц чужих тел событий
-- значило бы хранить чужую переписку дважды.
--
-- Идемпотентна.

BEGIN;

CREATE TABLE IF NOT EXISTS webhooks (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Человеческое имя: у компании их бывает несколько, и «на склад» с
  -- «в аналитику» различаются только так.
  title      text NOT NULL DEFAULT '',
  url        text NOT NULL,
  -- Секрет подписи и необязательный свой заголовок клиента.
  secret_enc bytea NOT NULL,
  events     text[] NOT NULL DEFAULT '{}',
  is_active  boolean NOT NULL DEFAULT true,
  -- Последний отказ и последний успех: по паре видно, вебхук лежит
  -- или лежал.
  last_error text,
  last_ok_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhooks_tenant_idx ON webhooks (tenant_id);

SELECT apply_tenant_rls('webhooks');

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  webhook_id uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event      text NOT NULL,
  -- Код ответа. Пусто — чужой сервер не ответил вовсе.
  status     int,
  error      text,
  tries      int NOT NULL DEFAULT 1,
  -- Тело события целиком: по нему работает кнопка «повторити».
  body       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_deliveries_hook_idx
  ON webhook_deliveries (webhook_id, created_at DESC);

SELECT apply_tenant_rls('webhook_deliveries');

COMMIT;
