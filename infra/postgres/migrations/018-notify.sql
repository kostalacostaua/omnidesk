-- Миграция 018 — оповещения.
--
-- Инбокс открыт не всегда. Ночью, в выходной, в дороге — клиент
-- написал, а узнать об этом неоткуда. Отсюда три адресата: группа в
-- Telegram (её читают все, кто в ней есть, и читают сразу), браузерный
-- пуш (для того, кто за компьютером, но в другой вкладке) и почта (для
-- того, кто не сидит ни там, ни там).
--
-- Адресаты лежат строками, а не колонками в настройках: групп бывает
-- две — «продажи» и «поломки», — и у каждой свой список событий. От
-- колонок пришлось бы отказываться на втором же клиенте.
--
-- Телеграм-адресат не хранит токен бота. Он ссылается на уже
-- подключённый канал: бот и так заведён, его токен и так зашифрован
-- ключом тенанта, и второй экземпляр того же секрета — это второе
-- место, откуда он может утечь.
--
-- notify_sent — защита от повтора. Событие «клиент ждёт ответа» ищется
-- обходом раз в минуту, и без отметки об отправке оператор получал бы
-- его каждую минуту, пока не ответит. Ключ идемпотентности строится
-- из события и того, о чём оно: один диалог — одно письмо.
--
-- Идемпотентна.

BEGIN;

-- Через сколько минут молчания считать, что клиент ждёт. Ноль —
-- не проверять вовсе: у кого-то в инбоксе сидят постоянно, и
-- напоминание через пять минут для них шум, а не помощь.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS waiting_alert_minutes int NOT NULL DEFAULT 15;

ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_waiting_alert_minutes_check;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_waiting_alert_minutes_check
  CHECK (waiting_alert_minutes BETWEEN 0 AND 1440);

COMMENT ON COLUMN tenants.waiting_alert_minutes IS
  'Через сколько минут без ответа оповестить о клиенте. 0 — не оповещать.';

CREATE TABLE IF NOT EXISTS notify_targets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('telegram', 'email', 'push')),
  -- Человеческое имя: «Група підтримки», «Пошта власника».
  title      text NOT NULL,
  -- telegram: { channelId, chatId }  email: { to }  push: {}
  config     jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Пустой список означает «ничего не присылать»: адресат создан, но
  -- молчит. Обратное правило («пусто — присылать всё») превращает
  -- любую опечатку в рассылку.
  events     text[] NOT NULL DEFAULT '{}',
  is_active  boolean NOT NULL DEFAULT true,
  last_error jsonb,
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notify_targets_tenant_idx ON notify_targets (tenant_id);

SELECT apply_tenant_rls('notify_targets');
GRANT SELECT, INSERT, UPDATE, DELETE ON notify_targets TO app_user;

-- Подписки браузера на пуш. Живут у человека, а не у компании: один и
-- тот же оператор сидит с рабочего компьютера и из дома, и это две
-- разные подписки с разными ключами.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   text NOT NULL,
  -- Ключи шифрования от браузера. Без них сообщение отправить нельзя:
  -- пуш-сервис передаёт только зашифрованный блок и сам его не читает.
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, endpoint)
);

CREATE INDEX IF NOT EXISTS push_subscriptions_tenant_idx ON push_subscriptions (tenant_id);

SELECT apply_tenant_rls('push_subscriptions');
GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO app_user;

CREATE TABLE IF NOT EXISTS notify_sent (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  dedup_key text NOT NULL,
  sent_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, dedup_key)
);

SELECT apply_tenant_rls('notify_sent');
GRANT SELECT, INSERT, UPDATE, DELETE ON notify_sent TO app_user;

DO $$
DECLARE
  t text;
  forced boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['notify_targets', 'push_subscriptions', 'notify_sent'] LOOP
    SELECT relforcerowsecurity INTO forced FROM pg_class WHERE relname = t;
    IF NOT forced THEN
      RAISE EXCEPTION '% без FORCE ROW LEVEL SECURITY — изоляция не работает', t;
    END IF;
  END LOOP;
  RAISE NOTICE 'оповещения: таблицы созданы, изоляция включена';
END $$;

COMMIT;
