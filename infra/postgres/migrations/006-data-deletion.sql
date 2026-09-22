-- Миграция 006 — запросы на удаление данных от Meta.
--
-- Человек удаляет приложение в настройках Facebook и просит удалить данные.
-- Meta присылает POST с подписанным запросом; мы обязаны подтвердить его
-- кодом и удалить данные. Таблица без tenant_id намеренно: в момент запроса
-- тенант неизвестен, его ищет воркер по идентификатору собеседника.
-- Пользовательских данных здесь нет — только внешний идентификатор.
--
-- Идемпотентна.

BEGIN;

CREATE TABLE IF NOT EXISTS data_deletion_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          text NOT NULL,
  external_id       text NOT NULL,
  confirmation_code text NOT NULL UNIQUE,
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','done','failed')),
  deleted_contacts  int NOT NULL DEFAULT 0,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz
);
CREATE INDEX IF NOT EXISTS ddr_pending_idx ON data_deletion_requests (status, created_at);

COMMENT ON TABLE data_deletion_requests IS
  'Запросы на удаление данных от Meta. Намеренно без RLS: приходят до '
  'определения тенанта и содержат только внешний идентификатор.';

GRANT SELECT, INSERT, UPDATE ON data_deletion_requests TO app_user;

COMMIT;
