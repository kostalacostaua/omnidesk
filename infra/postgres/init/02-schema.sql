-- ═══════════════════════════════════════════════════════════════════════
-- Схема ядра OmniDesk.
--
-- Выполняется после 01-rls-setup.sql, который создаёт роль app_user
-- и функцию apply_tenant_rls().
--
-- Правило: КАЖДАЯ таблица с колонкой tenant_id обязана получить
-- SELECT apply_tenant_rls('...') в той же миграции, что её создаёт.
-- Приложение проверяет это на старте и не запустится, если правило нарушено.
-- ═══════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

-- ─── Тенанты ────────────────────────────────────────────────────────────
-- Без tenant_id: это сам справочник тенантов, RLS к нему не применяется.
CREATE TABLE IF NOT EXISTS tenants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              citext UNIQUE NOT NULL,
  name              text NOT NULL,
  plan              text NOT NULL DEFAULT 'trial',
  seats_limit       int  NOT NULL DEFAULT 3,
  region            text NOT NULL DEFAULT 'eu',
  status            text NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ─── Пользователи ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email             citext NOT NULL,
  password_hash     text,
  full_name         text NOT NULL DEFAULT '',
  role              text NOT NULL DEFAULT 'agent'
                    CHECK (role IN ('owner','admin','agent','viewer')),
  zoho_user_id      text,
  zoho_zuid         text,
  is_active         boolean NOT NULL DEFAULT true,
  last_seen_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);
CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_zuid_idx
  ON users (tenant_id, zoho_zuid) WHERE zoho_zuid IS NOT NULL;
SELECT apply_tenant_rls('users');

-- ─── Установки Zoho ─────────────────────────────────────────────────────
-- accounts_server и api_domain НЕ хардкодятся в коде: они приходят
-- в callback (location / accounts-server) и в ответе на обмен токена.
-- Хардкод www.zohoapis.com ломает всех клиентов вне США.
CREATE TABLE IF NOT EXISTS zoho_installations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  zgid              text NOT NULL,
  org_name          text,
  location          text NOT NULL,
  accounts_server   text NOT NULL,
  api_domain        text NOT NULL,
  refresh_token_enc bytea NOT NULL,
  scopes            text[] NOT NULL DEFAULT '{}',
  edition           text,
  installed_by      uuid REFERENCES users(id),
  watch_channel_id  text,
  watch_expires_at  timestamptz,   -- максимум 1 неделя, продлевать кроном
  status            text NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, zgid)
);
SELECT apply_tenant_rls('zoho_installations');

-- Маршрутизация по организации Zoho: нужна, чтобы выдать сессию виджету
-- до того, как известен тенант. Та же логика, что и с channel_routes.
CREATE TABLE IF NOT EXISTS zoho_org_routes (
  zgid            text PRIMARY KEY,
  tenant_id       uuid NOT NULL,
  installation_id uuid NOT NULL,
  status          text NOT NULL
);
COMMENT ON TABLE zoho_org_routes IS
  'Маршрутизация по org id Zoho. Намеренно без RLS, пользовательских '
  'данных не содержит. Исключена из проверки RLS явным списком.';

CREATE OR REPLACE FUNCTION sync_zoho_org_route() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM zoho_org_routes WHERE installation_id = OLD.id;
    RETURN OLD;
  END IF;

  INSERT INTO zoho_org_routes (zgid, tenant_id, installation_id, status)
  VALUES (NEW.zgid, NEW.tenant_id, NEW.id, NEW.status)
  ON CONFLICT (zgid) DO UPDATE
    SET tenant_id       = EXCLUDED.tenant_id,
        installation_id = EXCLUDED.installation_id,
        status          = EXCLUDED.status;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS zoho_installations_sync_route ON zoho_installations;
CREATE TRIGGER zoho_installations_sync_route
  AFTER INSERT OR UPDATE OR DELETE ON zoho_installations
  FOR EACH ROW EXECUTE FUNCTION sync_zoho_org_route();

-- ─── Каналы ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channels (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type              text NOT NULL
                    CHECK (type IN ('whatsapp','instagram','messenger',
                                    'telegram_bot','telegram_business')),
  display_name      text NOT NULL,
  external_id       text NOT NULL,
  credentials_enc   bytea NOT NULL,
  meta              jsonb NOT NULL DEFAULT '{}',
  webhook_verified  boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','active','degraded','disconnected','banned')),
  last_error        jsonb,
  health_checked_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- Глобально: один номер/бот принадлежит ровно одному тенанту.
  -- Без этого два клиента могли бы подключить один номер и читать
  -- переписку друг друга.
  UNIQUE (type, external_id)
);
SELECT apply_tenant_rls('channels');

-- ─── Таблицы маршрутизации ──────────────────────────────────────────────
--
-- ЗАЧЕМ ОНИ НУЖНЫ. Когда приходит вебхук, мы ещё не знаем тенанта — его
-- как раз надо определить по phone_number_id / channel_id. Но таблица
-- channels под RLS: без выставленного app.tenant_id запрос вернёт ноль
-- строк, и ни одно сообщение никогда не будет обработано.
--
-- Напрашивающееся решение — завести роль с BYPASSRLS для «системных»
-- запросов. Мы этого НЕ делаем: такая роль умеет читать переписку всех
-- клиентов сразу, и рано или поздно кто-нибудь выполнит через неё
-- обычный запрос. Одна опечатка — утечка на всю базу.
--
-- Вместо этого выносим МИНИМУМ данных, нужных для маршрутизации, в отдельные
-- таблицы без RLS. В них нет ни сообщений, ни контактов, ни токенов — только
-- соответствие «внешний идентификатор → тенант». В результате в системе
-- не существует соединения, способного прочитать чужую переписку.
--
-- Синхронизация — триггером, чтобы не полагаться на дисциплину приложения.

CREATE TABLE IF NOT EXISTS channel_routes (
  channel_id   uuid PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL,
  channel_type text NOT NULL,
  external_id  text NOT NULL,
  status       text NOT NULL,
  UNIQUE (channel_type, external_id)
);
COMMENT ON TABLE channel_routes IS
  'Маршрутизация вебхуков. Намеренно БЕЗ RLS: читается до определения '
  'тенанта. Не содержит пользовательских данных — только соответствие '
  'внешнего идентификатора тенанту. Исключена из проверки RLS явным списком.';

CREATE OR REPLACE FUNCTION sync_channel_route() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM channel_routes WHERE channel_id = OLD.id;
    RETURN OLD;
  END IF;

  INSERT INTO channel_routes (channel_id, tenant_id, channel_type, external_id, status)
  VALUES (NEW.id, NEW.tenant_id, NEW.type, NEW.external_id, NEW.status)
  ON CONFLICT (channel_id) DO UPDATE
    SET tenant_id    = EXCLUDED.tenant_id,
        channel_type = EXCLUDED.channel_type,
        external_id  = EXCLUDED.external_id,
        status       = EXCLUDED.status;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS channels_sync_route ON channels;
CREATE TRIGGER channels_sync_route
  AFTER INSERT OR UPDATE OR DELETE ON channels
  FOR EACH ROW EXECUTE FUNCTION sync_channel_route();

-- ─── Контакты ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contacts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  display_name      text,
  avatar_url        text,
  phone_e164        text,
  email             citext,
  -- Кэш резолва в CRM. Экономит API-кредиты Zoho: без него вы упрётесь
  -- в суточный лимит и встанете на 24 часа.
  crm_module        text,
  crm_record_id     text,
  crm_owner_id      text,
  crm_synced_at     timestamptz,
  attributes        jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contacts_tenant_phone_idx ON contacts (tenant_id, phone_e164);
CREATE INDEX IF NOT EXISTS contacts_tenant_crm_idx   ON contacts (tenant_id, crm_module, crm_record_id);
SELECT apply_tenant_rls('contacts');

-- Один человек — много каналов.
CREATE TABLE IF NOT EXISTS contact_identities (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id        uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel_type      text NOT NULL,
  external_id       text NOT NULL,
  raw_profile       jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, channel_type, external_id)
);
SELECT apply_tenant_rls('contact_identities');

-- ─── Диалоги ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel_id        uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  contact_id        uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  assignee_id       uuid REFERENCES users(id),
  status            text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','pending','snoozed','resolved')),
  priority          smallint NOT NULL DEFAULT 0,
  -- Окно ответа: у каждого канала своё, вне окна свободный ответ запрещён.
  window_expires_at timestamptz,
  window_type       text,
  -- Привязка к записи CRM. Может отличаться от contacts:
  -- диалог может вестись в контексте конкретной сделки.
  crm_module        text,
  crm_record_id     text,
  last_message_at   timestamptz,
  unread_count      int NOT NULL DEFAULT 0,
  first_response_at timestamptz,
  resolved_at       timestamptz,
  tags              text[] NOT NULL DEFAULT '{}',
  -- Бот и человек: когда отвечал каждый. По этим отметкам решается,
  -- слать ли приветствие второй раз и не перебивает ли бот оператора.
  bot_replied_at    timestamptz,
  human_replied_at  timestamptz,
  bot_enabled       boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- Один диалог на пару «канал + контакт».
  UNIQUE (tenant_id, channel_id, contact_id)
);
CREATE INDEX IF NOT EXISTS conversations_inbox_idx
  ON conversations (tenant_id, status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS conversations_assignee_idx
  ON conversations (tenant_id, assignee_id, status);
CREATE INDEX IF NOT EXISTS conversations_crm_idx
  ON conversations (tenant_id, crm_module, crm_record_id);
SELECT apply_tenant_rls('conversations');

-- ─── Сообщения ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id   uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  channel_id        uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  external_id       text,
  direction         text NOT NULL CHECK (direction IN ('in','out')),
  sender_type       text NOT NULL CHECK (sender_type IN ('customer','agent','bot','system')),
  sender_user_id    uuid REFERENCES users(id),
  content           jsonb NOT NULL,
  status            text NOT NULL DEFAULT 'pending',
  failure           jsonb,
  billing           jsonb,
  -- Реакции лежат в самом сообщении: в отрыве от него они не имеют
  -- смысла и всегда читаются вместе с ним.
  reactions         jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw               jsonb,
  sent_at           timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- КРИТИЧНО: последний рубеж защиты от дублей.
-- Meta ретраит вебхуки до 7 дней при любом не-200 ответе. Redis-дедуп
-- может потерять ключ при перезапуске — этот индекс не пропустит дубль
-- ни при каких обстоятельствах.
CREATE UNIQUE INDEX IF NOT EXISTS messages_dedupe_idx
  ON messages (tenant_id, channel_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS messages_thread_idx
  ON messages (conversation_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS messages_text_search_idx
  ON messages USING gin ((content->>'text') gin_trgm_ops);
SELECT apply_tenant_rls('messages');

-- ПАРТИЦИОНИРОВАНИЕ. Пока таблица обычная — так проще начать и так
-- работает ON CONFLICT по частичному уникальному индексу.
-- Когда объём подойдёт к ~50 млн строк (для 50 тенантов это примерно
-- третий год работы), переведите на партиционирование по месяцам:
--
--   1. создать messages_partitioned (LIKE messages) PARTITION BY RANGE (sent_at)
--   2. включить sent_at в первичный ключ и в уникальный индекс
--   3. перелить данные, переключить имена
--   4. поставить pg_partman на автосоздание партиций
--
-- Раньше времени этого делать не надо: партиционирование усложняет
-- уникальные индексы и ON CONFLICT.

-- ─── Шаблоны WhatsApp ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_templates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel_id          uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  external_id         text,
  name                text NOT NULL,
  language            text NOT NULL,
  category            text NOT NULL,
  components          jsonb NOT NULL DEFAULT '{}',
  status              text NOT NULL DEFAULT 'PENDING',
  quality_score       text,
  rejected_reason     text,
  -- Meta переклассифицирует шаблоны задним числом (utility → marketing),
  -- что резко меняет стоимость. Отслеживайте message_template_status_update.
  category_changed_at timestamptz,
  synced_at           timestamptz,
  UNIQUE (tenant_id, channel_id, name, language)
);
SELECT apply_tenant_rls('message_templates');

-- ─── Быстрые ответы ─────────────────────────────────────────────────────
-- Шаблоны оператора: набрал /цена — подставился заготовленный текст.
-- Не путать с message_templates: те одобряются Meta и нужны, чтобы
-- вообще иметь право написать вне окна. Эти — просто экономия времени.
CREATE TABLE IF NOT EXISTS quick_replies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shortcut    text NOT NULL,
  body        text NOT NULL,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, shortcut)
);
SELECT apply_tenant_rls('quick_replies');

-- ─── Заметки оператора по контакту ──────────────────────────────────
CREATE TABLE IF NOT EXISTS contact_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  author_id   uuid REFERENCES users(id),
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
SELECT apply_tenant_rls('contact_notes');
CREATE INDEX IF NOT EXISTS contact_notes_contact_idx
  ON contact_notes (tenant_id, contact_id, created_at DESC);

-- ─── Правила чат-бота ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel_id    uuid REFERENCES channels(id) ON DELETE CASCADE,
  name          text NOT NULL,
  trigger_type  text NOT NULL DEFAULT 'contains'
                CHECK (trigger_type IN ('welcome','equals','contains','fallback')),
  keywords      text[] NOT NULL DEFAULT '{}',
  reply_text    text NOT NULL,
  priority      int NOT NULL DEFAULT 100,
  stop_after    boolean NOT NULL DEFAULT true,
  is_active     boolean NOT NULL DEFAULT true,
  hits          bigint NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
SELECT apply_tenant_rls('bot_rules');
CREATE INDEX IF NOT EXISTS bot_rules_active_idx
  ON bot_rules (tenant_id, is_active, priority);

CREATE INDEX IF NOT EXISTS conversations_inbox_idx
  ON conversations (tenant_id, status, last_message_at DESC NULLS LAST);

-- ─── Аудит ──────────────────────────────────────────────────────────────
-- «Кто из ваших сотрудников может прочитать нашу переписку?» — этот вопрос
-- вам зададут в каждом security questionnaire. Ответ должен опираться
-- на реальный журнал.
CREATE TABLE IF NOT EXISTS audit_log (
  id                bigserial PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id           uuid REFERENCES users(id),
  action            text NOT NULL,
  resource_type     text,
  resource_id       text,
  ip                inet,
  user_agent        text,
  metadata          jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_tenant_time_idx ON audit_log (tenant_id, created_at DESC);
SELECT apply_tenant_rls('audit_log');

-- ─── Transactional outbox ───────────────────────────────────────────────
-- Запись в CRM никогда не делается синхронно внутри обработки вебхука.
-- Пишем сюда в той же транзакции, что и сообщение; отдельный воркер
-- разгребает. Иначе падение Zoho API = потеря сообщений.
CREATE TABLE IF NOT EXISTS outbox (
  id                bigserial PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  topic             text NOT NULL,
  payload           jsonb NOT NULL,
  attempts          int NOT NULL DEFAULT 0,
  next_attempt_at   timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx
  ON outbox (next_attempt_at) WHERE processed_at IS NULL;
SELECT apply_tenant_rls('outbox');

-- ═══════════════════════════════════════════════════════════════════════
-- Финальная проверка: не осталось ли таблиц с tenant_id без RLS.
-- Если что-то забыли — миграция упадёт здесь, а не в проде через полгода.
-- ═══════════════════════════════════════════════════════════════════════
-- Явный список исключений. Только таблицы маршрутизации, и каждая
-- добавляется сюда осознанно, с обоснованием в COMMENT ON TABLE.
-- Тот же список продублирован в packages/core/src/db.ts — приложение
-- проверяет это на старте и не запустится при расхождении.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO missing
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND NOT c.relrowsecurity
    AND c.relname NOT IN ('channel_routes', 'zoho_org_routes', 'user_routes')
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = c.relname
        AND column_name = 'tenant_id'
    );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Таблицы с tenant_id без RLS: %', missing;
  END IF;
END
$$;

GRANT SELECT ON channel_routes, zoho_org_routes TO app_user;
