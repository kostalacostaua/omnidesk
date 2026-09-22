-- Миграция 009 — сценарии вместо плоских правил.
--
-- Что было. Правило: «пришло слово → отправить текст». Одно сообщение,
-- без продолжения. Живой разговор так не устроен: сначала приветствие,
-- потом уточняющий вопрос, пауза, если человек молчит — напоминание,
-- и передача оператору, когда дело дошло до денег.
--
-- Что стало. Сценарий — это цепочка шагов, которая выполняется по
-- порядку и умеет ждать: паузу по времени или ответ клиента. Шаги
-- лежат в jsonb одним массивом, а не отдельной таблицей: их единицы,
-- они всегда читаются целиком и всегда меняются целиком — отдельная
-- таблица дала бы три джойна и ноль пользы.
--
-- Состояние каждого запуска — в scenario_runs. Без него пауза в
-- пятнадцать минут означала бы, что воркер обязан дожить до конца
-- сценария, а перезапуск сервиса терял бы разговор на полуслове.
--
-- Старые правила переносятся в сценарии по одному шагу на правило.
-- Таблица bot_rules остаётся нетронутой: если что-то пойдёт не так,
-- есть куда посмотреть.
--
-- Идемпотентна.

BEGIN;

CREATE TABLE IF NOT EXISTS scenarios (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- NULL означает «на всех каналах»: одно приветствие на компанию —
  -- частый случай, и заводить его копией под каждый канал глупо.
  channel_id   uuid REFERENCES channels(id) ON DELETE CASCADE,
  name         text NOT NULL,
  trigger_type text NOT NULL DEFAULT 'keyword'
               CHECK (trigger_type IN ('welcome','keyword','exact','off_hours','fallback')),
  keywords     text[] NOT NULL DEFAULT '{}',
  -- Расписание для триггера «вне графика»: часы, дни недели и сдвиг
  -- часового пояса. Лежит здесь, а не в настройках компании, потому что
  -- у разных каналов бывает разный график.
  schedule     jsonb NOT NULL DEFAULT '{}'::jsonb,
  steps        jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active    boolean NOT NULL DEFAULT true,
  priority     int NOT NULL DEFAULT 100,
  runs_started  int NOT NULL DEFAULT 0,
  runs_finished int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scenarios_pick_idx
  ON scenarios (tenant_id, is_active, priority);

COMMENT ON COLUMN scenarios.steps IS
  'Массив шагов по порядку: message, delay, ask, condition, tag, handoff, close.';

CREATE TABLE IF NOT EXISTS scenario_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scenario_id     uuid NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  step_index      int NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running','waiting','done','stopped')),
  -- Чего ждём: 'reply' — ответа клиента, 'time' — наступления wait_until.
  waiting_for     text,
  wait_until      timestamptz,
  answers         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Один диалог — один живой запуск. Повторный запуск того же сценария
-- на том же диалоге означал бы два бота, перебивающих друг друга.
CREATE UNIQUE INDEX IF NOT EXISTS scenario_runs_live_idx
  ON scenario_runs (conversation_id)
  WHERE status IN ('running','waiting');

CREATE INDEX IF NOT EXISTS scenario_runs_wait_idx
  ON scenario_runs (status, wait_until)
  WHERE status = 'waiting';

SELECT apply_tenant_rls('scenarios');
SELECT apply_tenant_rls('scenario_runs');

GRANT SELECT, INSERT, UPDATE, DELETE ON scenarios TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON scenario_runs TO app_user;

-- Перенос старых правил. Каждое становится сценарием из одного шага.
-- Выполняется один раз: повторный запуск ничего не добавит, потому что
-- проверяется наличие сценария с тем же именем.
INSERT INTO scenarios (tenant_id, channel_id, name, trigger_type, keywords, steps, is_active, priority)
SELECT r.tenant_id,
       r.channel_id,
       r.name,
       CASE r.trigger_type
         WHEN 'welcome'  THEN 'welcome'
         WHEN 'contains' THEN 'keyword'
         WHEN 'equals'   THEN 'exact'
         WHEN 'fallback' THEN 'fallback'
         ELSE 'keyword'
       END,
       r.keywords,
       jsonb_build_array(jsonb_build_object('kind', 'message', 'text', r.reply_text)),
       r.is_active,
       r.priority
  FROM bot_rules r
 WHERE NOT EXISTS (
   SELECT 1 FROM scenarios s
    WHERE s.tenant_id = r.tenant_id AND s.name = r.name
 );

DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE relname = 'scenarios';
  IF NOT forced THEN
    RAISE EXCEPTION 'scenarios без FORCE ROW LEVEL SECURITY — изоляция не работает';
  END IF;
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE relname = 'scenario_runs';
  IF NOT forced THEN
    RAISE EXCEPTION 'scenario_runs без FORCE ROW LEVEL SECURITY — изоляция не работает';
  END IF;
  RAISE NOTICE 'scenarios: таблицы созданы, изоляция включена';
END $$;

COMMIT;
