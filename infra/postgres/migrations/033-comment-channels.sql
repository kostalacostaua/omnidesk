-- Миграция 033 — комментарии под постами как отдельные каналы.
--
-- Комментарий под постом — не личное сообщение. Его видят все, ответ на
-- него видят все, и уходит ответ под пост, а не в переписку. Поэтому
-- комментарии заводятся отдельным каналом рядом с Messenger и Instagram
-- той же страницы, а не подмешиваются в те же диалоги.
--
-- Отдельный канал — это не про красоту схемы. Диалог уникален по паре
-- «канал + контакт»: положи комментарии в тот же канал, и переписка в
-- личке склеится с обсуждением под постом, а оператор, отвечая, не будет
-- знать, кто это увидит. Заодно каналом раздаются права: у комментариев
-- своя команда чаще, чем общая.
--
-- Идемпотентна.

BEGIN;

ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_type_check;
ALTER TABLE channels ADD CONSTRAINT channels_type_check
  CHECK (type IN ('whatsapp','instagram','messenger',
                  'telegram_bot','telegram_business','telegram_user',
                  'viber_business','webchat','custom',
                  'messenger_comments','instagram_comments'));

COMMIT;
