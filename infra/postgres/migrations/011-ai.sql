-- Миграция 011 — подключение ИИ.
--
-- Ключ от модели принадлежит клиенту, а не нам: он платит своему
-- провайдеру сам и в любой момент может ключ отозвать. Поэтому ключ
-- лежит зашифрованным ключом тенанта — так же, как токен бота, — и
-- никогда не возвращается наружу: интерфейс показывает только хвост.
--
-- Настройка одна на компанию, а не на канал: текст про компанию,
-- цены и правила ответа везде один и тот же. Понадобится разный —
-- добавим channel_id отдельной строкой, ломать ничего не придётся.
--
-- Режимы. off — выключено; draft — ИИ пишет черновик по кнопке
-- оператора и ничего не отправляет сам; auto — отвечает клиенту, пока
-- за диалог не взялся человек. Черновик стоит первым намеренно:
-- отдавать переписку роботу без присмотра готовы далеко не все.
--
-- Идемпотентна.

BEGIN;

CREATE TABLE IF NOT EXISTS ai_settings (
  tenant_id     uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  -- Адрес совместимого с OpenAI API. Так подключаются и сам OpenAI, и
  -- почти все остальные: у них тот же /chat/completions.
  base_url      text NOT NULL DEFAULT 'https://api.openai.com/v1',
  model         text NOT NULL DEFAULT 'gpt-4o-mini',
  api_key_enc   bytea,
  -- Хвост ключа для интерфейса: «тот ли ключ» видно, а сам ключ нет.
  api_key_hint  text,
  system_prompt text NOT NULL DEFAULT '',
  mode          text NOT NULL DEFAULT 'draft' CHECK (mode IN ('off','draft','auto')),
  -- Сколько последних сообщений уходит в модель. Больше — дороже и
  -- медленнее, меньше — модель теряет нить разговора.
  history_size  int  NOT NULL DEFAULT 12 CHECK (history_size BETWEEN 2 AND 40),
  max_tokens    int  NOT NULL DEFAULT 400 CHECK (max_tokens BETWEEN 50 AND 2000),
  is_active     boolean NOT NULL DEFAULT true,
  -- Последняя ошибка от провайдера: без неё «почему не отвечает»
  -- выясняется только по логам сервера, куда клиент не заглянет.
  last_error    text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

SELECT apply_tenant_rls('ai_settings');

GRANT SELECT, INSERT, UPDATE, DELETE ON ai_settings TO app_user;

DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE relname = 'ai_settings';
  IF NOT forced THEN
    RAISE EXCEPTION 'ai_settings без FORCE ROW LEVEL SECURITY — изоляция не работает';
  END IF;
  RAISE NOTICE 'ai_settings: таблица создана, изоляция включена';
END $$;

COMMIT;
