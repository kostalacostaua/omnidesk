-- Миграция 005 — номерной Telegram (личный аккаунт через MTProto).
-- Идемпотентна.

BEGIN;

-- Имя ограничения не угадываем: снимаем любое CHECK на channels,
-- где перечислены типы каналов, и ставим новое с известным именем.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'channels'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%telegram_bot%'
  LOOP
    EXECUTE format('ALTER TABLE channels DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE channels ADD CONSTRAINT channels_type_check
  CHECK (type IN ('whatsapp','instagram','messenger',
                  'telegram_bot','telegram_business','telegram_user'));

COMMIT;
