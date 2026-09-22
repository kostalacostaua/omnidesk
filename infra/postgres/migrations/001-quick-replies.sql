-- Миграция 001 — шаблоны быстрых ответов.
--
-- Зачем отдельный файл. Скрипты в init/ выполняются ТОЛЬКО при первом
-- создании базы. У вас база уже создана, значит новая таблица из
-- 02-schema.sql туда никогда не попадёт — Postgres просто не запустит
-- этот каталог повторно. Поэтому всё, что добавляется после первого
-- запуска, живёт здесь и накатывается руками.
--
-- Запуск:
--   docker compose exec -T postgres psql -U omnidesk -d omnidesk \
--     < infra/postgres/migrations/001-quick-replies.sql
--
-- Файл идемпотентен: повторный запуск ничего не сломает.

BEGIN;

CREATE TABLE IF NOT EXISTS quick_replies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shortcut    text NOT NULL,
  body        text NOT NULL,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, shortcut)
);

-- Та же изоляция, что и у всех остальных таблиц с tenant_id.
-- Без этой строки шаблоны одного клиента были бы видны другому.
SELECT apply_tenant_rls('quick_replies');

GRANT SELECT, INSERT, UPDATE, DELETE ON quick_replies TO app_user;

COMMIT;

-- Проверка: политика должна быть на месте, а FORCE — включён.
DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE relname = 'quick_replies';
  IF NOT forced THEN
    RAISE EXCEPTION 'quick_replies без FORCE ROW LEVEL SECURITY — изоляция не работает';
  END IF;
  RAISE NOTICE 'quick_replies: таблица создана, изоляция включена';
END $$;
