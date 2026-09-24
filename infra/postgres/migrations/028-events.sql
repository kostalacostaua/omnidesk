-- Миграция 028 — лента событий.
--
-- Аналитика, SLA и KPI — три разных вопроса, но опираются они на одно:
-- что произошло и когда. Считать это по текущему состоянию диалога
-- нельзя. Состояние знает только последнее значение: кто ответственный
-- сейчас, какой статус сейчас. А спрашивают всегда про прошлое —
-- «сколько в среднем ждали в июне», «кто сколько закрыл на прошлой
-- неделе», — и на такие вопросы текущее состояние отвечает молчанием
-- или враньём.
--
-- Поэтому здесь append-only лента: строки только добавляются и никогда
-- не правятся. Событие — свидетельство, а не запись в справочнике;
-- исправленное свидетельство не стоит ничего.
--
-- Измерения (канал, сотрудник) лежат прямо в строке, а не берутся
-- потом по диалогу. Диалог могли переназначить трижды, и отчёт за июнь
-- обязан помнить, кто отвечал в июне, а не кто числится сегодня.
--
-- dedupe_key защищает от повторной записи: очередь доставляет задачу
-- «хотя бы раз», и без ключа перезапуск воркера удваивал бы числа в
-- отчётах. Ключ уникален в пределах арендатора, и вторая попытка
-- просто ничего не делает.
--
-- Идемпотентна.

BEGIN;

CREATE TABLE IF NOT EXISTS events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  at              timestamptz NOT NULL DEFAULT now(),
  type            text NOT NULL,
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  channel_id      uuid REFERENCES channels(id) ON DELETE SET NULL,
  -- Кто это сделал. Для входящего — пусто: там не наш человек.
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  dedupe_key      text,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE events IS
  'Лента событий: только добавление. Основа отчётов, SLA и KPI.';
COMMENT ON COLUMN events.dedupe_key IS
  'Ключ повтора: вторая доставка той же задачи не удваивает событие.';

-- Уникален только там, где задан: у событий без ключа повторов не бывает.
CREATE UNIQUE INDEX IF NOT EXISTS events_dedupe_idx
  ON events (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- Отчёт всегда спрашивает «за период», и почти всегда — с отбором по
-- типу: это и есть порядок полей в индексе.
CREATE INDEX IF NOT EXISTS events_report_idx ON events (tenant_id, type, at DESC);

-- Лента одного диалога: понадобится, когда в карточке появится история.
CREATE INDEX IF NOT EXISTS events_conv_idx ON events (conversation_id, at);

SELECT apply_tenant_rls('events');

GRANT SELECT, INSERT ON events TO app_user;

COMMIT;
