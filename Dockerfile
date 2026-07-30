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
# ★ npm не обязан поднимать все зависимости в корневой node_modules: в этом
# проекте `nanoid` он размещает в `server/node_modules` (и `client/`), а не в
# корне. Каталог создаётся заранее, чтобы COPY на следующей стадии не зависел от
# того, вложил npm зависимость или поднял — иначе сборка ломается при обновлении
# npm, а не при ошибке в коде.
RUN mkdir -p server/node_modules

# ── 4. Рантайм ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    STATIC_DIR=/app/client/dist

COPY --from=prod-deps /app/node_modules ./node_modules
# ★ Вложенные зависимости воркспейса обязательны: без этой строки образ
# собирается «зелёным», но контейнер падает при старте с `ERR_MODULE_NOT_FOUND:
# nanoid`. Дефект прожил с группы 1 до группы 15 именно потому, что образ ни
# разу не запускали — `docker build` успешен в обоих случаях.
COPY --from=prod-deps /app/server/node_modules ./server/node_modules
COPY package.json ./
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist

# ── 5. Проверка разрешимости импортов на этапе сборки ────────────────────────
#
# ★ Каждый собранный модуль импортируется в отдельном процессе: если хоть одна
# зависимость не доехала до образа, сборка падает здесь, а не в проде через
# секунду после деплоя. Точка входа исключена намеренно — её импорт поднял бы
# сервер и подвесил сборку.
#
# Это не замена запуску контейнера (шаг 7 CI поднимает образ и дёргает /health),
# а дешёвая страховка от самого частого класса ошибок многостадийной сборки:
# «собралось, но зависимости не скопированы».
RUN set -e; \
    for module in $(find server/dist shared/dist -name '*.js' ! -name 'index.js'); do \
      node --input-type=module -e "await import('/app/$module')"; \
    done; \
    echo 'проверка импортов пройдена'

# Node-образ уже содержит непривилегированного пользователя `node`.
USER node
EXPOSE 3001

# Q11: /health доступен только внутри сети, поэтому проверка идёт из самого
# контейнера (источник — 127.0.0.1) и не требует ослабления доступа.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
