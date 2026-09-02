# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile

FROM node:24-alpine
ENV NODE_ENV=production
ENV DATA_FILE=/data/rooms.json
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY server ./server
COPY shared ./shared
COPY client ./client
COPY package.json ./
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:${PORT:-3000}/ > /dev/null || exit 1
CMD ["node", "server/index.js"]
