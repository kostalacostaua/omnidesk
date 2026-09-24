-- Миграция 024 — свои статусы диалога.
--
-- Системных статусов четыре, и их менять нельзя: на них держатся
-- вкладки, счётчики и окна ответа. Но словарь оператора шире четырёх
-- слов, и «Чекаємо оплату» в списке чатов полезнее, чем «pending».
--
-- Поэтому свой статус не вместо системного, а поверх него:
--
--   conversation_statuses — только свои статусы арендатора;
--   conversations.status_id — какой из них надет на диалог;
--   conversations.status    — остаётся системной правдой.
--
-- Род (kind) обязателен и ограничен двумя значениями. Из него
-- вычисляется системный статус при выборе своего, и потому счётчик
-- «Відкриті» нельзя обмануть, придумав статус: диалог либо в работе,
-- либо закрыт, третьего в отчётах не бывает.
--
-- ON DELETE SET NULL, а не CASCADE: удалённый статус обязан снять себя
-- с диалогов, а не унести их с собой.
--
-- Идемпотентна.

BEGIN;

CREATE TABLE IF NOT EXISTS conversation_statuses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  color       text NOT NULL DEFAULT '#2563eb',
  kind        text NOT NULL CHECK (kind IN ('open','closed')),
  sort        smallint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Два статуса с одним названием — это опечатка, а не два статуса:
  -- в списке они неотличимы, и оператор выбирает наугад.
  UNIQUE (tenant_id, name)
);

COMMENT ON COLUMN conversation_statuses.kind IS
  'Род: open — диалог в работе, closed — закрыт. Задаёт системный статус.';

CREATE INDEX IF NOT EXISTS conversation_statuses_order_idx
  ON conversation_statuses (tenant_id, sort, name);

SELECT apply_tenant_rls('conversation_statuses');

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS status_id uuid
    REFERENCES conversation_statuses(id) ON DELETE SET NULL;

COMMENT ON COLUMN conversations.status_id IS
  'Свой статус арендатора поверх системного status. NULL — только системный.';

-- Срез «покажи все с этим статусом» — самая частая причина, по которой
-- свои статусы вообще заводят.
CREATE INDEX IF NOT EXISTS conversations_status_id_idx
  ON conversations (tenant_id, status_id)
  WHERE status_id IS NOT NULL;

COMMIT;
