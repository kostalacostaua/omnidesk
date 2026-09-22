-- Миграция 003 — реакции и вложения в исходящих.
--
-- Запуск:
--   cmd /c "docker compose exec -T postgres psql -U omnidesk -d omnidesk < infra\postgres\migrations\003-reactions-and-files.sql"
--
-- Идемпотентна.

BEGIN;

-- Реакции лежат в самом сообщении, а не отдельной таблицей.
-- Причина простая: реакция не имеет самостоятельной жизни. Её нельзя
-- найти, отфильтровать или посчитать в отрыве от сообщения, а читается
-- она всегда вместе с ним. Отдельная таблица дала бы join на каждой
-- загрузке ленты ради данных, которые всё равно приезжают целиком.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reactions jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Поиск сообщения по идентификатору у провайдера нужен теперь и для
-- реакций (Telegram присылает их отдельным обновлением со ссылкой
-- на message_id), и для цитаты в ответе.
CREATE INDEX IF NOT EXISTS messages_external_lookup_idx
  ON messages (tenant_id, channel_id, external_id)
  WHERE external_id IS NOT NULL;

COMMIT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'messages' AND column_name = 'reactions'
  ) THEN
    RAISE EXCEPTION 'колонка reactions не создана';
  END IF;
  RAISE NOTICE 'миграция 003: реакции и вложения готовы';
END $$;
