-- Миграция 017 — Viber для бизнеса.
--
-- Личного («номерного») Viber в списке нет намеренно: открытого
-- протокола для личных аккаунтов у Viber не существует, а библиотеки,
-- которые притворяются телефоном, нарушают их правила — номер за это
-- блокируют. Подключается то, что работает по-настоящему: Viber
-- Business Messages через официального партнёра, с именем отправителя
-- вместо номера.
--
-- Идемпотентна.

BEGIN;

ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_type_check;
ALTER TABLE channels ADD CONSTRAINT channels_type_check
  CHECK (type IN ('whatsapp','instagram','messenger',
                  'telegram_bot','telegram_business','telegram_user',
                  'viber_business'));

COMMIT;
