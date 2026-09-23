-- Миграция 016 — пауза бота после ответа оператора настраивается.
--
-- Правило было зашито: оператор ответил — бот молчит тридцать минут,
-- чтобы не вклиниваться в живой разговор. Правило хорошее, но немое:
-- человек пишет сценарий, проверяет его в своём же диалоге, где сам
-- только что отвечал, ничего не происходит — и он делает вывод, что
-- сценарии не работают.
--
-- Теперь это число видно в интерфейсе и его можно менять, в том числе
-- поставить ноль на время проверки.
--
-- Идемпотентна.

BEGIN;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS bot_pause_minutes int NOT NULL DEFAULT 30;

ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_bot_pause_minutes_check;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_bot_pause_minutes_check
  CHECK (bot_pause_minutes BETWEEN 0 AND 1440);

COMMENT ON COLUMN tenants.bot_pause_minutes IS
  'Сколько минут бот молчит после ответа оператора. 0 — не молчит.';

COMMIT;
