-- Миграция 004 — вход по коду на почту.
--
-- Запуск:
--   cmd /c "docker compose exec -T postgres psql -U omnidesk -d omnidesk < infra\postgres\migrations\004-email-login.sql"
--
-- Идемпотентна.

BEGIN;

-- ─── Маршрутизация по почте ─────────────────────────────────────────
-- Та же задача, что у channel_routes, и то же решение.
--
-- В момент, когда человек вводит почту, тенант ещё неизвестен — значит
-- контекст RLS выставить не из чего, а таблица users под RLS и вернёт
-- пусто. Нужна таблица без RLS, но тогда любое подключение к базе может
-- её прочитать целиком. Поэтому здесь лежит абсолютный минимум: почта,
-- идентификатор тенанта и пользователя. Ни имени, ни роли, ни переписки.
--
-- Ключ составной, а не по одной почте: один и тот же человек может
-- работать в двух организациях. Раньше это молча ломало бы вход
-- «первый попавшийся тенант побеждает» — теперь на такой случай
-- интерфейс спрашивает, куда входить.
CREATE TABLE IF NOT EXISTS user_routes (
  email      citext NOT NULL,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_active  boolean NOT NULL DEFAULT true,
  PRIMARY KEY (email, tenant_id)
);
CREATE INDEX IF NOT EXISTS user_routes_email_idx ON user_routes (email);

-- Синхронизация из users. Триггером, а не кодом приложения: код можно
-- забыть позвать из нового места, триггер — нет.
CREATE OR REPLACE FUNCTION sync_user_route() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM user_routes WHERE user_id = OLD.id;
    RETURN OLD;
  END IF;

  -- Почту могли поменять: старая строка маршрута должна уйти,
  -- иначе по ней останется вход у человека, которого уже переименовали.
  DELETE FROM user_routes WHERE user_id = NEW.id AND email <> NEW.email;

  INSERT INTO user_routes (email, tenant_id, user_id, is_active)
  VALUES (NEW.email, NEW.tenant_id, NEW.id, NEW.is_active)
  ON CONFLICT (email, tenant_id) DO UPDATE
    SET user_id = EXCLUDED.user_id, is_active = EXCLUDED.is_active;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS users_sync_route ON users;
CREATE TRIGGER users_sync_route
  AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION sync_user_route();

-- Первичное заполнение для уже существующих пользователей.
INSERT INTO user_routes (email, tenant_id, user_id, is_active)
SELECT email, tenant_id, id, is_active FROM users
ON CONFLICT (email, tenant_id) DO UPDATE
  SET user_id = EXCLUDED.user_id, is_active = EXCLUDED.is_active;

-- ─── Одноразовые коды ───────────────────────────────────────────────
-- Хранится ХЭШ кода, а не сам код. Разница существенная: с дампом базы
-- на руках нельзя войти чужой почтой, дожидаясь, пока жертва запросит код.
--
-- attempts нужен против перебора: шестизначный код — это миллион
-- вариантов, что подбирается за минуты, если не считать попытки.
CREATE TABLE IF NOT EXISTS auth_codes (
  email       citext PRIMARY KEY,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    int NOT NULL DEFAULT 0,
  sent_count  int NOT NULL DEFAULT 1,
  window_from timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON user_routes TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth_codes TO app_user;

COMMIT;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM user_routes;
  RAISE NOTICE 'миграция 004: вход по почте готов, маршрутов пользователей: %', n;
END $$;
