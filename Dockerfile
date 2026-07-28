# Прод-образ (задача IP 1.6, TDD §12.1, §12.2).
#
# Один контейнер: Node раздаёт собранную статику клиента и обслуживает socket.io.
# Один origin — прямое следствие §12.2, из него же вытекает отсутствие CORS.
# Q4: Node 20 LTS (TDD §14.1).

# ── 1. Зависимости для сборки (включая dev) ──────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
# `--ignore-scripts`: детерминированная установка без postinstall-хуков пакетов.
RUN npm ci --ignore-scripts

# ── 2. Сборка shared → client → server ───────────────────────────────────────
FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json ./
COPY shared/ shared/
COPY client/ client/
COPY server/ server/
RUN npm run build --workspace shared \
    && npm run build --workspace client \
    && npm run build --workspace server

# ── 3. Только прод-зависимости ───────────────────────────────────────────────
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --ignore-scripts

# ── 4. Рантайм ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    STATIC_DIR=/app/client/dist

COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist

# Node-образ уже содержит непривилегированного пользователя `node`.
USER node
EXPOSE 3001

# Q11: /health доступен только внутри сети, поэтому проверка идёт из самого
# контейнера (источник — 127.0.0.1) и не требует ослабления доступа.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
