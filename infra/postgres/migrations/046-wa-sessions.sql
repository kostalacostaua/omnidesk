-- Сессии номерного WhatsApp.
--
-- Сессия — это не настройка канала, а состояние живого соединения:
-- ключи шифрования, счётчики, предварительные ключи подписи. Их много,
-- они меняются на каждом сообщении, и класть их в channels.meta значит
-- переписывать карточку канала десятки раз в минуту.
--
-- Хранится зашифрованным на ключе арендатора, как и любые учётные
-- данные: тот, кто получит дамп базы, не должен получить вместе с ним
-- чужую переписку.
--
-- Строка одна на канал. Пропала — человек сканирует QR заново, и это
-- единственное последствие: переписка лежит отдельно.
CREATE TABLE IF NOT EXISTS wa_sessions (
  channel_id uuid PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Учётные данные аккаунта: кто мы для WhatsApp.
  creds_enc  bytea NOT NULL,
  -- Ключи шифрования переписки. Отдельным полем, потому что меняются
  -- чаще и целиком: переписывать вместе с ними учётные данные незачем.
  keys_enc   bytea,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wa_sessions_tenant_idx ON wa_sessions (tenant_id);

SELECT apply_tenant_rls('wa_sessions');
