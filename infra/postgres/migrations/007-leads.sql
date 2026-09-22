-- Миграция 007 — заявки с промо-страницы.
--
-- Таблица намеренно без tenant_id и без RLS: заявку оставляет человек,
-- у которого ещё нет ни аккаунта, ни тенанта — привязать её не к чему.
-- Пишет сюда только публичный обработчик POST /leads, читает владелец
-- сервиса. Чтобы страница не превратилась в источник спама, вставка
-- ограничена не правами, а обработчиком: одна заявка с адреса в час.
--
-- Идемпотентна.

BEGIN;

CREATE TABLE IF NOT EXISTS leads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text,
  email       text NOT NULL,
  phone       text,
  company     text,
  channels    text,
  note        text,
  source      text NOT NULL DEFAULT 'landing',
  locale      text,
  -- Полезно ровно один раз: понять, откуда пришла заявка, если их
  -- вдруг стало много за минуту. Адрес не показываем и не храним
  -- дольше, чем саму заявку.
  ip          inet,
  status      text NOT NULL DEFAULT 'new'
              CHECK (status IN ('new','contacted','trial','won','lost','spam')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  handled_at  timestamptz
);

CREATE INDEX IF NOT EXISTS leads_created_idx ON leads (created_at DESC);
CREATE INDEX IF NOT EXISTS leads_email_idx ON leads (lower(email), created_at DESC);

COMMENT ON TABLE leads IS
  'Заявки на пробный доступ с промо-страницы. Намеренно без RLS: '
  'приходят до появления тенанта.';

GRANT SELECT, INSERT, UPDATE ON leads TO app_user;

COMMIT;
