-- Миграция 017 — Viber для бизнеса.
--
-- Пока только бизнес-канал: Viber Business Messages через официального
-- партнёра, с именем отправителя вместо номера. Номерной Viber в
-- интерфейсе помечен как «в работе»; когда для него найдётся партнёр,
-- добавится ещё один тип канала — эта проверка расширяется одной
-- строкой, ничего перекладывать не придётся.
--
-- Идемпотентна.

BEGIN;

ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_type_check;
ALTER TABLE channels ADD CONSTRAINT channels_type_check
  CHECK (type IN ('whatsapp','instagram','messenger',
                  'telegram_bot','telegram_business','telegram_user',
                  'viber_business'));

COMMIT;
