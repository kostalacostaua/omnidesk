-- Миграция 027 — кто какими папками шаблонов пользуется.
--
-- Шаблоны у компании общие, но не все одинаково уместны: в папке
-- «Рекламації» лежат тексты, которые оператор продаж вставит не там и
-- не тогда, а в «Опт» — условия, которые рознице показывать нельзя.
--
-- Правило то же, что у каналов, и намеренно то же: одно правило на две
-- разные вещи человек помнит, два — путает.
--
--   владелец и администратор   — все папки;
--   пустой список у человека   — все папки;
--   список задан               — только эти.
--
-- Шаблоны вне папок видны всем и не раздаются. «Без папки» — это не
-- папка, а её отсутствие: дать или отнять там нечего, а спрятать за
-- ограничением заготовки, которые никто не раскладывал, значит забрать
-- у оператора половину его работы молча.
--
-- Идемпотентна.

BEGIN;

CREATE TABLE IF NOT EXISTS user_reply_folders (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id  uuid NOT NULL REFERENCES reply_folders(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, folder_id)
);

-- Выборка всегда идёт по человеку: «какие папки ему видны».
CREATE INDEX IF NOT EXISTS user_reply_folders_user_idx ON user_reply_folders (user_id);

SELECT apply_tenant_rls('user_reply_folders');

GRANT SELECT, INSERT, UPDATE, DELETE ON user_reply_folders TO app_user;

COMMIT;
