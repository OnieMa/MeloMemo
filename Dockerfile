# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl ffmpeg yt-dlp \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV API_PORT=8787
ENV DATABASE_URL=file:/app/data/melomemo.db
ENV APP_TIME_ZONE=Asia/Shanghai

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl ffmpeg yt-dlp \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app /app

RUN mkdir -p /app/data /app/server/uploads /app/server/dictionaries \
  && chown -R node:node /app

USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "npx prisma db push --skip-generate && npm run server"]
