-- Миграция 031 — цели сотрудников.
--
-- Отчёт показывает, сколько человек сделал. Цель отвечает на другой
-- вопрос — много это или мало, — и без неё число в таблице читает
-- только тот, кто и так знает ответ. «Оля: 18 ответов» само по себе не
-- значит ничего: восемнадцать за неделю при одном канале — хорошо, при
-- четырёх — беда.
--
-- Цели живут одной таблицей на два случая. Строка без сотрудника —
-- общая цель компании, она же и есть ответ по умолчанию для каждого;
-- строка с сотрудником перекрывает её для него одного. Две таблицы
-- (общая и личная) означали бы два места, где правда, и вопрос, какое
-- из них главнее, всплывал бы при каждой правке.
--
-- Цели дневные. Не недельные и не месячные: у смены разная длина, люди
-- болеют и уходят в отпуск, и «сорок за неделю» у того, кто работал
-- три дня, — это не невыполнение, а неверный вопрос. Дневная цель
-- умножается на число рабочих дней в периоде, и это видно в отчёте.
--
-- Ноль означает «не ставим цель», а не «цель ноль»: пустая цель
-- честнее выдуманной, потому что по ней потом разговаривают с людьми.
--
-- Идемпотентна.

BEGIN;

CREATE TABLE IF NOT EXISTS kpi_goals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- NULL — общая цель компании.
  user_id          uuid REFERENCES users(id) ON DELETE CASCADE,
  replies_per_day  int NOT NULL DEFAULT 0,
  resolved_per_day int NOT NULL DEFAULT 0,
  -- Доля ответов в срок, в процентах. 0 — не требуем.
  in_time_percent  int NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Общая цель у арендатора одна, личная — одна на человека. Частичные
-- индексы, потому что обычный UNIQUE с NULL пропустил бы десять общих.
CREATE UNIQUE INDEX IF NOT EXISTS kpi_goals_default_idx
  ON kpi_goals (tenant_id) WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS kpi_goals_user_idx
  ON kpi_goals (tenant_id, user_id) WHERE user_id IS NOT NULL;

SELECT apply_tenant_rls('kpi_goals');

GRANT SELECT, INSERT, UPDATE, DELETE ON kpi_goals TO app_user;

COMMIT;
