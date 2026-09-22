-- Миграция 002 — заметки по контакту и правила чат-ботов.
--
-- Всё остальное для нового интерфейса в схеме уже было: у диалога есть
-- assignee_id, status и tags, у контакта — attributes. Достраиваем ровно
-- две недостающие сущности, ничего не переписывая.
--
-- Запуск:
--   cmd /c "docker compose exec -T postgres psql -U omnidesk -d omnidesk < infra\postgres\migrations\002-inbox-and-bots.sql"
--
-- Файл идемпотентен.

BEGIN;

-- ─── Заметки оператора по контакту ──────────────────────────────────
-- Не сообщения: клиент их не видит. Нужны, чтобы следующий оператор
-- не начинал разговор с нуля.
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
-- Осознанно НЕ визуальный конструктор сценариев. Правило — это
-- «условие на входящий текст → ответ». Такая модель закрывает
-- подавляющее большинство реальных автоответов и, в отличие от
-- графа сценариев, не может зациклиться или зависнуть на шаге.
--
-- trigger_type:
--   welcome  — первое сообщение в новом диалоге, текст не важен
--   equals   — точное совпадение (после приведения к нижнему регистру)
--   contains — вхождение любого из ключевых слов
--   fallback — ничего не совпало и оператор ни разу не отвечал
CREATE TABLE IF NOT EXISTS bot_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel_id    uuid REFERENCES channels(id) ON DELETE CASCADE,  -- NULL = все каналы
  name          text NOT NULL,
  trigger_type  text NOT NULL DEFAULT 'contains'
                CHECK (trigger_type IN ('welcome','equals','contains','fallback')),
  keywords      text[] NOT NULL DEFAULT '{}',
  reply_text    text NOT NULL,
  -- Меньше — раньше. При равном приоритете выигрывает созданное раньше.
  priority      int NOT NULL DEFAULT 100,
  -- Остановить обработку после срабатывания. Без этого одно сообщение
  -- могло бы вызвать три ответа подряд и выглядеть как сбой.
  stop_after    boolean NOT NULL DEFAULT true,
  is_active     boolean NOT NULL DEFAULT true,
  hits          bigint NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
SELECT apply_tenant_rls('bot_rules');
CREATE INDEX IF NOT EXISTS bot_rules_active_idx
  ON bot_rules (tenant_id, is_active, priority);

-- ─── Признак «ботом уже отвечали» ───────────────────────────────────
-- Нужен, чтобы приветствие не уходило дважды и чтобы fallback не
-- срабатывал в диалоге, где живой оператор уже включился.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS bot_replied_at timestamptz;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS human_replied_at timestamptz;
-- Бот выключается для конкретного диалога, когда оператор берёт его на себя.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS bot_enabled boolean NOT NULL DEFAULT true;

-- Список диалогов всегда сортируется по времени последнего сообщения
-- и фильтруется по статусу. Без индекса это seq scan на каждый опрос
-- интерфейса — то есть раз в три секунды на каждого открытого оператора.
CREATE INDEX IF NOT EXISTS conversations_inbox_idx
  ON conversations (tenant_id, status, last_message_at DESC NULLS LAST);

GRANT SELECT, INSERT, UPDATE, DELETE ON contact_notes, bot_rules TO app_user;

COMMIT;

DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(t, ', ') INTO missing
    FROM unnest(ARRAY['contact_notes','bot_rules']) AS t
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_class WHERE relname = t AND relforcerowsecurity
   );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'без FORCE ROW LEVEL SECURITY: %', missing;
  END IF;
  RAISE NOTICE 'миграция 002: заметки и правила ботов готовы, изоляция включена';
END $$;
