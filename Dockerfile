# syntax=docker/dockerfile:1

# 构建阶段：安装完整依赖，生成 Prisma Client，并把 Vite 前端编译成 dist。
# 这一阶段产物会复制到最终镜像中；最终运行时不会重新编译前端。
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# 安装构建和运行都需要的系统依赖：
# - ca-certificates: 让 Node/fetch/yt-dlp 能正常访问 HTTPS
# - openssl: Prisma 在 Debian slim 镜像中需要 OpenSSL runtime
# - ffmpeg: YouTube 下载后的音频转码依赖
# - yt-dlp: YouTube 音频、字幕下载依赖
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl ffmpeg yt-dlp \
  && rm -rf /var/lib/apt/lists/*

# 先只复制 package 文件并 npm ci，利用 Docker layer cache。
# 只有依赖声明变化时才会重新安装依赖。
COPY package.json package-lock.json ./
RUN npm ci

# 复制完整源码后生成 Prisma Client，再构建前端。
# npm run build 会执行 tsc -b 和 vite build。
COPY . .
RUN npx prisma generate
RUN npm run build

# 运行阶段：保留生产运行所需的源码、dist、node_modules 和 Prisma Client。
# 当前服务端使用 tsx 直接运行 server/index.ts，所以 devDependencies 仍需要保留。
FROM node:22-bookworm-slim AS runner

WORKDIR /app

# 默认生产环境变量：
# - API_PORT: Fastify 监听端口
# - DATABASE_URL: SQLite 数据库放在 /app/data，方便挂载 volume 持久化
# - APP_TIME_ZONE: 学习统计按中国时区计算日期
ENV NODE_ENV=production
ENV API_PORT=8787
ENV DATABASE_URL=file:/app/data/melomemo.db
ENV APP_TIME_ZONE=Asia/Shanghai

# 运行阶段也需要 ffmpeg/yt-dlp/openssl，因为 YouTube 下载、转码和 Prisma
# 都是在容器运行时发生的。
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl ffmpeg yt-dlp \
  && rm -rf /var/lib/apt/lists/*

# 复制构建阶段的完整应用，包括：
# - dist 前端静态文件
# - server 后端源码
# - prisma schema 和生成后的 Prisma Client
# - node_modules
COPY --from=builder /app /app

# 创建运行时持久化目录：
# - /app/data: SQLite 数据库
# - /app/server/uploads: 用户上传音频、封面、YouTube 下载文件、TTS 缓存
# - /app/server/dictionaries: 可选本地词典 CSV
# 切换为 node 用户前先调整权限，避免运行时无法写入 volume。
RUN mkdir -p /app/data /app/server/uploads /app/server/dictionaries \
  && chown -R node:node /app

# 使用非 root 用户运行服务，降低容器权限。
USER node

# 容器内部服务端口。docker-compose 会把宿主机端口映射到这里。
EXPOSE 8787

# 健康检查访问后端 /api/health。
# GitHub Actions 或服务器编排工具可用这个状态判断容器是否正常。
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 启动时先同步 SQLite 表结构，再启动 Fastify 服务。
# --skip-generate 是因为镜像构建阶段已经执行过 prisma generate。
CMD ["sh", "-c", "npx prisma db push --skip-generate && npm run server"]
