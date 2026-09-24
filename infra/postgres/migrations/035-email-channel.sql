-- Миграция 035 — почта как канал.
--
-- Клиенты пишут на support@ и ждут ответа там же. До сих пор эта
-- переписка жила отдельно от всех остальных: в почтовом ящике, куда
-- ходит один человек, без ответственных, без отчётов и без истории
-- клиента.
--
-- Домен канала — поддомен клиента (help.firma.com), а не его основной
-- домен: MX у домена один, и перенаправив его на нас, клиент потеряет
-- собственную почту. Поддомен позволяет принимать заявки у нас, оставив
-- рабочие ящики там, где они были.
--
-- Идемпотентна.

BEGIN;

ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_type_check;
ALTER TABLE channels ADD CONSTRAINT channels_type_check
  CHECK (type IN ('whatsapp','instagram','messenger',
                  'telegram_bot','telegram_business','telegram_user',
                  'viber_business','webchat','custom',
                  'messenger_comments','instagram_comments','email'));

COMMIT;
