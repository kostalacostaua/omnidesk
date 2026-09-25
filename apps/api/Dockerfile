# Многоступенчатая сборка: в финальный образ не попадают ни исходники,
# ни devDependencies, ни компилятор TypeScript.
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages/core/package.json ./packages/core/
COPY apps/api/package.json ./apps/api/
RUN npm ci

COPY packages/core ./packages/core
COPY apps/api ./apps/api
COPY scripts ./scripts
COPY infra/postgres ./infra/postgres
RUN npx tsc --build apps/api

# Страница интерфейса собирается из шаблонной строки, и компилятор не видит
# внутри неё синтаксиса JavaScript. Проверяем результат отдельно: иначе
# сломанный скрипт доедет до браузера и покажет пустую страницу.
RUN node scripts/check-ui.mjs

# Обращение к JSON по индексу без ::int Postgres молча превращает в NULL.
# Такую ошибку не видно ни компилятору, ни тестам — только пользователю.
RUN node scripts/check-sql.mjs

# Таблица с tenant_id без RLS роняет api на старте — правильно, но узнавать
# об этом на работающем сервере дорого. Ловим до сборки образа.
RUN node scripts/check-rls.mjs

# Оставляем только production-зависимости
RUN npm prune --omit=dev

# Пакет, версия которого разошлась между приложениями, npm не
# поднимает в общий node_modules — он остаётся в своём. Каталог
# создаётся пустым заранее, чтобы копирование ниже не падало,
# когда поднялось всё.
RUN mkdir -p apps/api/node_modules

FROM node:22-alpine AS runtime
WORKDIR /app

# tini корректно передаёт сигналы: без него SIGTERM не доходит
# до процесса Node и контейнер убивается по таймауту, обрывая
# обработку сообщений на середине.
RUN apk add --no-cache tini

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules

# Схема едет в образе: миграции запускаются перед каждым деплоем
# (apps/api/dist/migrate.js), а у управляемой базы нет initdb.d.
COPY --from=builder /app/infra/postgres ./infra/postgres

# Каталог вложений создаётся ЗАРАНЕЕ и с правильным владельцем.
# Docker при первом создании именованного тома копирует туда права
# из образа. Без этого том остаётся root:root, а контейнер работает
# под node — и запись падает с EACCES уже в проде, на первом же файле.
RUN mkdir -p /data/media && chown -R node:node /data/media

# Контейнер работает не от root. Образ node уже содержит пользователя node.
USER node

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/api/dist/main.js"]
