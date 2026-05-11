# MeloMemo Docker 部署说明

当前 Docker 架构是单容器部署：

- Vite 前端在镜像构建阶段编译到 `dist/`。
- Fastify 后端在运行时同时提供 `/api/*`、`/uploads/*` 和前端静态页面。
- SQLite 数据库保存到 `/app/data/melomemo.db`。
- 上传的歌曲、封面、YouTube 下载文件、TTS 缓存保存到 `/app/server/uploads`。
- 字典目录保存到 `/app/server/dictionaries`。
- `ffmpeg` 和 `yt-dlp` 已安装在镜像中，用于 YouTube 下载和转码。

## 文件说明

- `Dockerfile`：构建生产镜像。
- `docker-compose.yml`：本机或服务器直接启动容器。
- `.env.docker.example`：Docker 运行时环境变量模板。
- `.dockerignore`：避免把本地数据库、上传文件、密钥和 `node_modules` 打进镜像。

## 快速启动

```bash
docker compose up -d --build
```

如果需要配置 YouTube API、讯飞 TTS 或微信登录，再复制环境变量模板：

```bash
cp .env.docker.example .env.docker
docker compose up -d --build
```

启动后访问：

```text
http://localhost:8787
```

健康检查：

```bash
curl http://localhost:8787/api/health
```

预期返回：

```json
{"ok":true}
```

## 数据持久化

`docker-compose.yml` 默认创建 3 个 volume：

- `melomemo-data`：SQLite 数据库。
- `melomemo-uploads`：上传音频、封面、YouTube 下载文件、TTS mp3 缓存。
- `melomemo-dictionaries`：本地词典 CSV。

停止容器不会删除数据：

```bash
docker compose down
```

如果要连数据一起删除：

```bash
docker compose down -v
```

## 环境变量

复制 `.env.docker.example` 后按需填写：

```env
DATABASE_URL="file:/app/data/melomemo.db"
API_PORT=8787
APP_TIME_ZONE=Asia/Shanghai
```

可选能力：

- `YOUTUBE_API_KEY` 或 `GOOGLE_API_KEY`：YouTube 官方搜索接口。
- `YOUTUBE_SEARCH_PROXY`：YouTube 搜索代理。
- `XF_APPID`、`XF_API_KEY`、`XF_API_SECRET`：讯飞 TTS。
- `WECHAT_APP_ID`、`WECHAT_REDIRECT_URI`：微信登录。

这些密钥只放在 `.env.docker`，不要提交。

## 镜像构建

只构建镜像：

```bash
docker build -t melomemo:latest .
```

只运行镜像：

```bash
docker run --rm -p 8787:8787 \
  --env-file .env.docker \
  -v melomemo-data:/app/data \
  -v melomemo-uploads:/app/server/uploads \
  -v melomemo-dictionaries:/app/server/dictionaries \
  melomemo:latest
```

## 数据库初始化

容器启动命令会自动执行：

```bash
npx prisma db push --skip-generate
```

所以首次启动会自动创建 SQLite 表结构；后续 schema 有变化时也会自动同步。

## 测试建议

1. `docker compose up -d --build`。
2. 打开 `http://localhost:8787`，确认前端页面可访问。
3. 访问 `http://localhost:8787/api/health`，确认 API 正常。
4. 注册或登录账号，确认 SQLite 数据库可写。
5. 上传一首本地歌曲，确认 `melomemo-uploads` volume 中产生文件。
6. 进入本地模式，创建本地数据后登录，按 `TESTING_GUIDE.md` 验证本地数据同步。
7. 如果填写了讯飞 TTS 环境变量，点击单词发音验证 `/api/tts`。
8. 如果需要 YouTube 下载，确认容器内 `yt-dlp` 和 `ffmpeg` 可用：

```bash
docker compose exec melomemo yt-dlp --version
docker compose exec melomemo ffmpeg -version
```

## 常见问题

### 端口冲突

如果本机 `8787` 已被占用，修改 `docker-compose.yml`：

```yaml
ports:
  - "8080:8787"
```

然后访问 `http://localhost:8080`。

### SQLite 文件位置

默认数据库在容器内：

```text
/app/data/melomemo.db
```

它由 `melomemo-data` volume 持久化。

### 前端刷新 404

后端已经添加 SPA fallback。只要镜像里存在 `dist/index.html`，刷新任意前端路由都会回到前端页面；`/api/*` 和 `/uploads/*` 不会被 fallback 吃掉。
