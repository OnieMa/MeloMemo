# MeloMemo 产品说明书

MeloMemo 是一款面向英文歌曲学习场景的 Web 应用。它把歌曲播放、歌词逐词查询、标准发音、生词收藏和学习档案整合在一起，让用户可以在听歌过程中自然完成听力、词汇和发音练习。

## 1. 产品定位

MeloMemo 的核心目标是把“听英文歌”变成可互动的语言学习流程：

- 用户上传或选择英文歌曲。
- 播放歌曲时查看同步歌词。
- 点击歌词中的英文单词，查看中文释义、词性、例句、美式音标和英式音标。
- 点击美式或英式音标，播放对应口音的标准发音。
- 将生词保存到个人词本。
- 收藏歌曲，并在个人页查看学习数据和收藏内容。

## 2. 核心功能

### 2.1 曲库与歌曲上传

曲库页提供推荐歌曲卡片，并支持上传本地歌曲。上传歌曲时需要提供：

- 歌曲名称
- 艺术家
- 音频文件
- 歌词文件或歌词内容
- 可选封面图

后端会把音频和封面保存到 `server/uploads/`，并将歌曲元数据写入 SQLite 数据库。

### 2.2 歌词播放与学习

歌词掌握页是主要学习界面：

- 底部播放器支持播放、暂停、上一首、下一首、循环、随机、收藏和音量控制。
- 播放进度条嵌入播放栏内部顶部，避免与内容区割裂。
- 歌词支持逐词点击。
- 已上传歌曲会按照歌词时间轴进行同步高亮。
- 点击词条会打开单词卡片。

### 2.3 单词卡片

点击英文单词后，单词卡片会展示：

- 单词原文
- 美式音标
- 英式音标
- 词性
- 中文释义
- 英文释义或例句
- 来源歌曲和时间点
- 标准发音按钮
- 原唱慢放按钮
- 加入生词本按钮

美式音标和英式音标本身也是可点击控件：

- 点击美式音标，请求 `lang: "en-US"` 的讯飞 TTS。
- 点击英式音标，请求 `lang: "en-GB"` 的讯飞 TTS。
- 默认“标准发音”按钮使用美式发音。

### 2.4 科大讯飞 TTS 发音

发音功能由后端代理调用科大讯飞在线语音合成流式版 API。

前端不会直接访问讯飞接口，也不会暴露密钥。前端只调用：

```http
POST /api/tts
```

请求示例：

```json
{
  "text": "apple",
  "lang": "en-US"
}
```

后端会：

- 使用环境变量中的 `XF_APPID`、`XF_API_KEY`、`XF_API_SECRET` 签名鉴权。
- 通过 WebSocket 请求 `wss://tts-api.xfyun.cn/v2/tts`。
- 使用 `aue=lame` 生成 mp3 音频。
- 按单词、语言、音色、语速、音量和音调生成缓存键。
- 将生成的 mp3 缓存到 `server/uploads/tts/`。

缓存键格式：

```text
tts:<lang>:<voice>:<text>:<speed>:<volume>:<pitch>
```

示例：

```text
tts:en-US:catherine:apple:42:85:50
tts:en-GB:mary:apple:42:85:50
```

如果讯飞接口不可用，前端只显示错误提示，不再调用浏览器 `speechSynthesis`。

### 2.5 本地英汉词库

MeloMemo 使用 ECDICT 作为本地英汉词库。词库用于提供中文释义和基础音标。

本地查询优先级：

1. `server/dictionaries/ecdict.csv`
2. `dictionaryapi.dev`
3. 内置 fallback 小词典

音标处理策略：

- 中文释义优先来自 ECDICT。
- 美式和英式音标尽量从 `dictionaryapi.dev` 的发音条目补齐。
- 如果在线音标不可用，则回退到 ECDICT 的 `phonetic` 字段。

词性处理策略：

- 优先读取 ECDICT 的 `pos` 字段。
- 如果 `pos` 为空，则从释义中的 `n.`、`vt.`、`vi.`、`a.`、`adv.` 等前缀解析。
- 后端会把常见缩写转换成中文标签，例如 `n. 名词`、`vt. 及物动词`、`adj. 形容词`。

### 2.6 生词本

用户可以把单词卡片中的词保存到生词本。保存内容包括：

- 单词
- 音标
- 中文释义
- 例句
- 来源歌曲
- 来源歌词行
- 来源时间点

生词本数据存储在 `VocabularyWord` 表中。

### 2.7 收藏歌曲

用户可以在底部播放器中点击爱心收藏当前歌曲。收藏内容包括：

- 歌曲标题
- 艺术家
- 音频地址
- 封面地址
- 歌词数据

收藏歌曲会展示在个人页的“我的收藏”区域。

### 2.8 个人档案

个人页展示：

- 用户头像和昵称
- 等级标题
- 累计学习天数
- 掌握单词数量
- 攻克难句数量
- 收藏歌曲数量
- Pro 会员展示卡片
- 学习入口列表

当前系统会自动创建默认演示用户：

```text
demo@melomemo.local
melomemo-demo
```

## 3. 技术架构

### 3.1 前端技术

前端使用：

- React 19
- Vite 7
- Zustand
- Recharts
- CSS 原生样式
- Material Symbols 图标
- Web Audio / HTMLAudioElement

主要文件：

```text
src/main.jsx      前端主应用和页面组件
src/store.ts      Zustand 全局状态
src/data.ts       静态展示数据
src/styles.css    全站样式
```

前端状态管理由 Zustand 负责，包括：

- 当前视图
- 播放状态
- 当前用户
- 用户资料统计
- 已上传歌曲
- 本地曲库
- 收藏歌曲
- 生词本
- 待跳转播放时间点

### 3.2 后端技术

后端使用：

- Fastify 5
- Prisma ORM
- SQLite
- `@fastify/cors`
- `@fastify/multipart`
- `@fastify/static`
- `dotenv`
- `ws`
- Node.js 原生 `crypto`

主要文件：

```text
server/index.ts   Fastify API 服务
prisma/schema.prisma 数据库模型
```

后端能力包括：

- 用户注册和登录
- 默认用户创建
- 用户资料读取和更新
- 歌曲上传
- 静态文件托管
- 收藏歌曲
- 生词本
- 本地词库加载
- 在线词典补充
- 科大讯飞 TTS 代理
- TTS 音频缓存

### 3.3 数据库

数据库使用 SQLite，通过 Prisma 访问。

默认数据库地址来自环境变量：

```text
DATABASE_URL="file:./dev.db"
```

数据模型：

```text
User
UserProfile
Song
VocabularyWord
UserFavoriteSong
```

#### User

保存用户基础信息：

- email
- passwordHash
- displayName
- avatarUrl
- bio
- levelTitle

#### UserProfile

保存学习统计：

- cumulativeDays
- masteredWords
- conqueredSentences

#### Song

保存用户上传歌曲：

- title
- artist
- audioUrl
- coverUrl
- lyrics

`lyrics` 当前以 JSON 字符串保存。

#### VocabularyWord

保存生词：

- word
- phonetic
- meaning
- example
- sourceSong
- sourceSongId
- sourceTime
- sourceLine

#### UserFavoriteSong

保存收藏歌曲：

- favoriteKey
- title
- artist
- audioUrl
- coverUrl
- lyrics

### 3.4 文件存储

运行时文件不提交到 Git。

```text
server/uploads/                 上传音频、封面和 TTS mp3 缓存
server/uploads/tts/             讯飞 TTS 生成的 mp3
server/dictionaries/ecdict.csv  本地 ECDICT 词库
prisma/dev.db                   SQLite 数据库
```

`.gitignore` 已忽略：

```text
.env.local
.env*.local
server/uploads/
server/dictionaries/*.csv
prisma/dev.db
prisma/dev.db-journal
```

## 4. API 说明

### 4.1 健康检查

```http
GET /api/health
```

返回：

```json
{ "ok": true }
```

### 4.2 用户

```http
POST /api/auth/register
POST /api/auth/login
GET /api/auth/me
```

当前前端使用 `localStorage` 保存 `userId`，并通过 `x-user-id` 请求头传给后端。

### 4.3 个人资料

```http
GET /api/profile
PATCH /api/profile
```

### 4.4 曲库

```http
GET /api/songs
POST /api/songs
```

`POST /api/songs` 使用 `multipart/form-data` 上传音频、封面和歌词信息。

### 4.5 查词

```http
GET /api/dictionary/:word
```

返回示例：

```json
{
  "word": "apple",
  "phonetic": "/ˈæp.əl/",
  "usPhonetic": "/ˈæp.əl/",
  "ukPhonetic": "/ˈæp.əl/",
  "partOfSpeech": "n. 名词",
  "meaning": "n. 苹果, 家伙",
  "source": "ECDICT local dictionary + Free Dictionary API phonetics"
}
```

### 4.6 TTS

```http
POST /api/tts
```

请求：

```json
{
  "text": "apple",
  "lang": "en-US"
}
```

返回：

```json
{
  "url": "/uploads/tts/xxx.mp3",
  "cached": true,
  "cacheKey": "tts:en-US:catherine:apple:42:85:50",
  "engine": "xfyun-online-tts",
  "lang": "en-US",
  "voice": "catherine"
}
```

### 4.7 收藏歌曲

```http
GET /api/favorites
POST /api/favorites
DELETE /api/favorites/:favoriteKey
```

### 4.8 生词本

```http
GET /api/vocabulary
POST /api/vocabulary
DELETE /api/vocabulary/:word
```

## 5. 环境变量

建议创建 `.env.local`：

```bash
DATABASE_URL="file:./dev.db"
API_PORT=8787

XF_APPID=你的讯飞 APPID
XF_API_KEY=你的讯飞 APIKey
XF_API_SECRET=你的讯飞 APISecret

XF_TTS_EN_US_VOICE=catherine
XF_TTS_EN_GB_VOICE=mary
XF_TTS_SPEED=42
XF_TTS_VOLUME=85
XF_TTS_PITCH=50
```

说明：

- `XF_APPID`、`XF_API_KEY`、`XF_API_SECRET` 只能放在服务端环境变量中。
- 前端不会读取这些密钥。
- `XF_TTS_EN_US_VOICE` 控制美式英文音色。
- `XF_TTS_EN_GB_VOICE` 控制英式英文音色。
- `XF_TTS_SPEED`、`XF_TTS_VOLUME`、`XF_TTS_PITCH` 范围为 0 到 100。

## 6. 本地启动

### 6.1 安装依赖

```bash
npm install
```

### 6.2 创建环境变量

复制示例文件：

```bash
cp .env.example .env.local
```

然后填写讯飞密钥。

### 6.3 初始化数据库

```bash
npm run db:generate
npm run db:push
```

### 6.4 下载本地词库

```bash
npm run dict:download
```

该命令会下载完整 ECDICT 到：

```text
server/dictionaries/ecdict.csv
```

文件约 63MB，不会提交到 Git。

### 6.5 启动开发服务

```bash
npm run dev
```

该命令会同时启动：

```text
前端 Vite:    http://localhost:5173
后端 Fastify: http://localhost:8787
```

Vite 已配置代理：

```text
/api     -> http://localhost:8787
/uploads -> http://localhost:8787
```

也可以分别启动：

```bash
npm run dev:web
npm run dev:api
```

### 6.6 生产构建

```bash
npm run build
```

本地预览：

```bash
npm run preview
```

## 7. 推荐测试流程

1. 启动后端和前端。
2. 打开 `http://localhost:5173`。
3. 进入歌词掌握页。
4. 点击英文歌词中的单词。
5. 确认弹窗展示中文释义、词性、美式音标和英式音标。
6. 点击“标准发音”，确认播放美式讯飞 TTS。
7. 点击“美式音标”，确认请求 `en-US`。
8. 点击“英式音标”，确认请求 `en-GB`。
9. 再次点击同一个词，确认后端返回 `cached: true`。
10. 点击“加入生词本”，确认个人页或词本中出现该词。
11. 点击播放器爱心，确认歌曲出现在个人页收藏列表。

## 8. 目录结构

```text
MeloMemo/
  src/
    main.jsx
    store.ts
    data.ts
    styles.css
  server/
    index.ts
    dictionaries/
      .gitkeep
      ecdict.csv        本地下载，不提交
    uploads/            运行时上传和 TTS 缓存，不提交
  prisma/
    schema.prisma
    dev.db              本地数据库，不提交
  scripts/
    download-ecdict.mjs
  vite.config.ts
  package.json
  .env.example
  README.md
```

## 9. 已知限制

- 当前认证是轻量演示方案，前端通过 `localStorage` 保存用户 ID，并以 `x-user-id` 传给后端；生产环境应改为安全会话或 JWT。
- 本地歌词解析依赖上传歌词格式，复杂歌词格式仍有改进空间。
- ECDICT 的释义覆盖面大，但部分词条格式并不完全统一，因此后端做了词性解析和在线音标补充。
- `dictionaryapi.dev` 可用性受网络影响，失败时不会影响本地中文释义。
- 讯飞 TTS 免费额度有限，已通过本地 mp3 缓存减少重复调用。
- 当前音频文件存储在本地目录，生产环境可迁移到对象存储。

## 10. 常用命令

```bash
npm install          安装依赖
npm run db:generate  生成 Prisma Client
npm run db:push      同步 SQLite 数据库结构
npm run dict:download 下载 ECDICT 本地词库
npm run dev          同时启动前端和后端
npm run dev:web      只启动前端
npm run dev:api      只启动后端
npm run build        TypeScript 与前端生产构建
npm run preview      预览生产构建
```
