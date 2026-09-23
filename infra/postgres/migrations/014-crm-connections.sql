-- Миграция 014 — CRM, кроме Zoho: Битрикс24 и Pipedrive.
--
-- У Zoho своя таблица: там OAuth, дата-центры, refresh-токен и виджет в
-- карточке — всё это к другим CRM отношения не имеет. Остальные
-- подключаются проще и одинаково: клиент приносит один адрес с ключом
-- (вебхук Битрикса) или домен и токен (Pipedrive). Для них одна общая
-- таблица, а не по таблице на каждую: поля совпадают, а различается
-- только то, что лежит внутри зашифрованного блока.
--
-- Битрикс подключается вебхуком намеренно. Полноценное приложение
-- Битрикса надо публиковать в их маркете и проводить модерацию; входящий
-- вебхук клиент создаёт сам за минуту, и он одинаково работает и в
-- облаке, и в коробке на своём сервере — отличается только адрес.
--
-- Ключи лежат зашифрованными ключом тенанта и наружу не возвращаются:
-- в интерфейсе видно только домен и хвост.
--
-- Идемпотентна.

BEGIN;

CREATE TABLE IF NOT EXISTS crm_connections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('bitrix24','pipedrive')),
  -- Что показать человеку: адрес портала или компании.
  title       text NOT NULL DEFAULT '',
  -- Вебхук Битрикса целиком или домен и токен Pipedrive.
  creds_enc   bytea NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','degraded')),
  last_error  text,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Одно подключение одной CRM на компанию: две записи в разные
  -- Битриксы означали бы, что лид уезжает в обе, и никто не знает,
  -- какая из карточек настоящая.
  UNIQUE (tenant_id, kind)
);

SELECT apply_tenant_rls('crm_connections');

GRANT SELECT, INSERT, UPDATE, DELETE ON crm_connections TO app_user;

-- В какой именно CRM лежит карточка контакта. До этого было только
-- «модуль и номер записи» — этого хватало, пока CRM была одна.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS crm_kind text;

DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE relname = 'crm_connections';
  IF NOT forced THEN
    RAISE EXCEPTION 'crm_connections без FORCE ROW LEVEL SECURITY — изоляция не работает';
  END IF;
  RAISE NOTICE 'crm_connections: таблица создана, изоляция включена';
END $$;

COMMIT;
