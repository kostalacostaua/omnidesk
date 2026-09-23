-- Миграция 013 — кто какие каналы видит.
--
-- До этого любой сотрудник видел всю переписку компании. Для магазина
-- из двух человек это норма, для агентства с подрядчиками — нет:
-- оператор, которого взяли вести один Instagram, читал и личные
-- диалоги владельца в Telegram.
--
-- Доступ задаётся списком: строка «этому человеку этот канал». Пустой
-- список означает «все каналы» — так ведут себя все, кто заведён до
-- этой миграции, и так же ведёт себя новый оператор, пока
-- администратор не ограничил его явно. Обратный порядок (пусто —
-- ничего не видно) выглядит строже, но на деле означает, что каждый
-- новый сотрудник в первый день видит пустой экран и пишет в
-- поддержку.
--
-- Владелец и администратор в этой таблице не участвуют вовсе: они
-- отвечают за компанию целиком и видят всё.
--
-- Идемпотентна.

BEGIN;

CREATE TABLE IF NOT EXISTS user_channels (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel_id)
);

-- Выборка всегда идёт по человеку: «какие каналы ему видны».
CREATE INDEX IF NOT EXISTS user_channels_user_idx ON user_channels (user_id);

SELECT apply_tenant_rls('user_channels');

GRANT SELECT, INSERT, UPDATE, DELETE ON user_channels TO app_user;

DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE relname = 'user_channels';
  IF NOT forced THEN
    RAISE EXCEPTION 'user_channels без FORCE ROW LEVEL SECURITY — изоляция не работает';
  END IF;
  RAISE NOTICE 'user_channels: таблица создана, изоляция включена';
END $$;

COMMIT;
