-- ═══════════════════════════════════════════════════════════════════════
-- Изоляция тенантов через Row-Level Security
--
-- Главный контур безопасности всей системы. Он работает НИЖЕ вашего кода:
-- даже если в запросе забыли WHERE tenant_id = ..., Postgres не отдаст
-- чужие строки.
--
-- Три условия, без которых RLS бесполезен:
--   1. Приложение подключается под app_user (см. 00-app-role.sh),
--      а не под владельцем БД.
--   2. FORCE ROW LEVEL SECURITY — чтобы политики действовали и на владельца.
--   3. В начале КАЖДОЙ транзакции выставляется app.tenant_id —
--      это делает withTenant() в packages/core/src/db.ts.
-- ═══════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- регистронезависимые email и slug
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- поиск по истории сообщений

-- ═══════════════════════════════════════════════════════════════════════
-- Хелпер: применить изоляцию к таблице одной командой.
-- Вызывать для КАЖДОЙ новой таблицы с tenant_id — в той же миграции,
-- что её создаёт.
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION apply_tenant_rls(tbl regclass)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE  ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', tbl);

  -- NULLIF(..., '') принципиально важен.
  --
  -- current_setting('app.tenant_id', true) вернёт NULL, если параметр
  -- никогда не выставляли, но ПУСТУЮ СТРОКУ, если его сбросили через
  -- set_config(..., '', ...). Без NULLIF попытка привести '' к uuid
  -- падает с ошибкой «invalid input syntax for type uuid».
  --
  -- Это не косметика: при сбросе контекста запрос должен вернуть НОЛЬ
  -- СТРОК, а не уронить транзакцию. Иначе любая ошибка в управлении
  -- контекстом превращается в отказ обслуживания.
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s '
    'USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) '
    'WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
    tbl
  );
END;
$fn$;

COMMENT ON FUNCTION apply_tenant_rls IS
  'Включает изоляцию по tenant_id. Обязательно вызывать для каждой новой '
  'таблицы с колонкой tenant_id.';

-- ═══════════════════════════════════════════════════════════════════════
-- Использование из приложения (TypeScript):
--
--   await withTenant(pool, tenantId, async (db) => {
--     return db.query('SELECT * FROM conversations');   // фильтр не нужен
--   });
--
-- Внутри withTenant():
--   BEGIN;
--   SELECT set_config('app.tenant_id', $1, true);   -- true = только транзакция
--   ...
--   COMMIT;
--
-- Третий аргумент set_config обязан быть true. Без него значение утечёт
-- на следующий запрос, который возьмёт это же соединение из пула. Это самая
-- опасная ошибка в мультитенанте: проявляется редко, под нагрузкой,
-- и выглядит как «клиент увидел чужие данные».
-- ═══════════════════════════════════════════════════════════════════════
