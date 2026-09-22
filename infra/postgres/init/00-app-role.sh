#!/bin/bash
#
# Создаёт непривилегированную роль app_user, под которой работает приложение.
#
# Почему это критично: владелец таблицы ОБХОДИТ политики RLS, если для
# таблицы не задан FORCE ROW LEVEL SECURITY. Мы задаём FORCE, но полагаться
# только на это нельзя — приложение обязано ходить под отдельной ролью
# без права менять схему.
#
# Скрипт выполняется автоматически при первой инициализации кластера
# (docker-entrypoint-initdb.d). На существующем томе он НЕ запустится —
# если меняете пароль, делайте это вручную через ALTER ROLE.

set -euo pipefail

if [[ -z "${APP_DB_PASSWORD:-}" ]]; then
  echo "ОШИБКА: APP_DB_PASSWORD не задан. Заполните .env" >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    DO \$\$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user LOGIN;
      END IF;
    END
    \$\$;

    ALTER ROLE app_user PASSWORD '${APP_DB_PASSWORD}';

    -- app_user НЕ суперюзер и НЕ может обходить RLS
    ALTER ROLE app_user NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

    GRANT CONNECT ON DATABASE "${POSTGRES_DB}" TO app_user;
    GRANT USAGE ON SCHEMA public TO app_user;

    -- Права на таблицы, которые появятся позже (создаются владельцем)
    ALTER DEFAULT PRIVILEGES FOR ROLE "${POSTGRES_USER}" IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
    ALTER DEFAULT PRIVILEGES FOR ROLE "${POSTGRES_USER}" IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO app_user;

    -- Схему менять нельзя: миграции выполняются под владельцем
    REVOKE CREATE ON SCHEMA public FROM app_user;
EOSQL

echo "Роль app_user создана"
