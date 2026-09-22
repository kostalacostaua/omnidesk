# Многоступенчатая сборка: в финальный образ не попадают ни исходники,
# ни devDependencies, ни компилятор TypeScript.
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages/core/package.json ./packages/core/
COPY apps/poller/package.json ./apps/poller/
RUN npm ci

COPY packages/core ./packages/core
COPY apps/poller ./apps/poller
RUN npx tsc --build apps/poller

# Оставляем только production-зависимости
RUN npm prune --omit=dev

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
COPY --from=builder /app/apps/poller/dist ./apps/poller/dist
COPY --from=builder /app/apps/poller/package.json ./apps/poller/

# Контейнер работает не от root. Образ node уже содержит пользователя node.
USER node

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/poller/dist/main.js"]
