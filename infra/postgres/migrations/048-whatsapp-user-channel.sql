-- Миграция 048 — номерной WhatsApp в списке разрешённых каналов.
--
-- Тип канала перечислен в базе отдельно от кода: база — последний, кто
-- может не дать записать мусор в поле, по которому потом маршрутизируются
-- сообщения. Новый тип появился в коде, а здесь его не было — и канал не
-- заводился совсем, уже после успешного входа по QR.
--
-- Перечисление целиком, а не «добавить одно значение»: у CHECK нет
-- «добавить», и переписать его целиком — единственный способ; заодно
-- видно весь список сразу.
--
-- Идемпотентна.

BEGIN;

ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_type_check;
ALTER TABLE channels ADD CONSTRAINT channels_type_check
  CHECK (type IN ('whatsapp','whatsapp_user','instagram','messenger',
                  'telegram_bot','telegram_business','telegram_user',
                  'viber_business','webchat','custom',
                  'messenger_comments','instagram_comments','email'));

COMMIT;
