-- Миграция 012 — какой провайдер отвечает.
--
-- Было «любой совместимый с OpenAI адрес». Gemini в эту схему не
-- ложится: у неё модель стоит в пути запроса, ключ идёт своим
-- заголовком, а переписка называется contents, а не messages. Признак
-- провайдера нужен именно поэтому — по одному адресу угадывать формат
-- значит ошибаться на первом же клиенте с собственным доменом.
--
-- Значение по умолчанию openai: у всех, кто подключился до этой
-- миграции, ровно оно и есть.
--
-- Идемпотентна.

BEGIN;

ALTER TABLE ai_settings
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'openai';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_settings_provider_check'
  ) THEN
    ALTER TABLE ai_settings
      ADD CONSTRAINT ai_settings_provider_check CHECK (provider IN ('openai','gemini'));
  END IF;
END $$;

COMMIT;
