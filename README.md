# MeloMemo 产品说明书

MeloMemo 是一款面向英文歌曲学习场景的 Web 应用。它把歌曲播放、歌词逐词查询、标准发音、生词收藏和学习档案整合在一起，让用户可以在听歌过程中自然完成听力、词汇和发音练习。

## 1. 产品定位

MeloMemo 的核心目标是把“听英文歌”变成可互动的语言学习流程：

- 用户上传或选择英文歌曲。
- 也可以通过搜索 YouTube 或粘贴 YouTube 视频链接，将有权保存的内容下载为 MP3 加入曲库。
- 播放歌曲时查看同步歌词。
- 点击歌词中的英文单词，查看中文释义、词性、例句、美式音标和英式音标。
- 点击美式或英式音标，播放对应口音的标准发音。
- 将生词保存到个人词本。
- 收藏歌曲，并在个人页查看学习数据和收藏内容。

## 2. 核心功能

### 2.1 曲库、歌曲上传与 YouTube 导入

曲库页提供推荐歌曲卡片，并支持上传本地歌曲。上传歌曲时需要提供：

- 歌曲名称
- 艺术家
- 音频文件
- 歌词文件或歌词内容
- 可选封面图

后端会把音频和封面保存到 `server/uploads/`，并将歌曲元数据写入 SQLite 数据库。

曲库也支持从 YouTube 导入歌曲：

- 顶部搜索栏默认先查本地曲库；本地命中时直接打开歌曲，不再请求 YouTube。
- 本地没有命中时，YouTube 搜索最多返回 20 条视频结果。
- 点击 YouTube 结果会先打开视频预览弹窗，支持播放、暂停和拖动进度条预览。
- 确认后才会下载并转换为 MP3，不会因为点到列表项就立即下载。
- 在页面中粘贴 YouTube 视频链接时，会自动识别链接并打开同一套预览弹窗。
- 对粘贴的视频链接，确认下载后会先弹出歌曲信息表单，用户可手动填写歌曲名和歌手名；填写内容会用于曲库存储和歌词搜索，不填写则回退使用 YouTube 标题和频道名。
- 下载过程中会展示阶段式进度，包括连接 YouTube、提取音频、下载封面、转码 MP3、匹配歌词和写入曲库。
- 新下载的歌曲会把 MP3、封面和歌词 JSON 放在同一个歌曲目录下，方便维护关联关系。
- 曲库卡片支持删除歌曲，删除时会同步清理数据库记录、收藏关联、音频文件、封面文件和歌词文件。

### 2.2 歌词播放与学习

歌词掌握页是主要学习界面：

- 底部播放器支持播放、暂停、上一首、下一首、循环、随机、收藏、倍速和音量控制。
- 上传歌曲和 YouTube 下载歌曲会组成统一播放队列。
- 上一首、下一首、随机播放、顺序播放、列表循环和单曲循环都基于该播放队列工作。
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

点击单词卡片外部区域可关闭卡片。歌词位置较低时，单词卡片会自动限制在视口内，避免操作按钮出现在屏幕之外。

美式音标和英式音标本身也是可点击控件：

- 点击美式音标，请求 `lang: "en-US"` 的讯飞 TTS。
- 点击英式音标，请求 `lang: "en-GB"` 的讯飞 TTS。
- 默认“标准发音”按钮使用美式发音。

### 2.4 歌词交互与编辑

同步歌词支持更细的学习交互：

- 鼠标悬浮在歌词行左侧跳转区时，会高亮当前歌词行。
- 点击歌词行左侧跳转区，会把播放进度跳到该行时间点。
- Web 端右键歌词行可打开歌词编辑弹窗。
- 移动端长按歌词行可打开歌词编辑弹窗。
- 修改歌词后会保存到数据库；对于 YouTube 下载歌曲，也会同步写回对应的歌词 JSON 文件。
- 顶部搜索栏可切换“搜歌曲”和“搜歌词”。搜歌词时需要输入歌曲名和歌手名，返回 LRCLIB 候选歌词，用户确认后可替换当前歌曲歌词。

### 2.5 科大讯飞 TTS 发音

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

### 2.6 本地英汉词库

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

### 2.7 生词本

用户可以把单词卡片中的词保存到生词本。保存内容包括：

- 单词
- 音标
- 中文释义
- 例句
- 来源歌曲
- 来源歌词行
- 来源时间点

生词本数据存储在 `VocabularyWord` 表中。

### 2.8 重点词汇卡片

发现页的“重点词汇卡片”来自用户查词热度，而不是静态随机词。

- 每次点击英文单词并完成释义查询后，该用户对应单词的 `lookupCount` 加 1。
- 后端会保存单词、释义、音标、词性、查询次数和最后查询时间。
- 默认只展示查询次数最高的前几项，保持页面紧凑。
- 点击“查看全部”后，会按查询次数从高到低展示所有已查询单词。

### 2.9 收藏歌曲

用户可以在底部播放器中点击爱心收藏当前歌曲。收藏内容包括：

- 歌曲标题
- 艺术家
- 音频地址
- 封面地址
- 歌词数据

收藏歌曲会展示在个人页的“我的收藏”区域。

### 2.10 个人档案

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

### 2.11 学习时间统计

当用户播放一首本地歌曲时，前端会自动记录真实学习时长：

- 播放开始后立即标记当天已学习。
- 播放过程中按真实经过时间累计学习秒数。
- 暂停、切歌、离开页面或停止播放时会刷新剩余学习秒数。
- 后端按用户和自然日聚合数据。
- 学习进度页展示连续学习天数、累计学习时长和过去 30 天学习曲线。

统计使用用户本地日期上报 `dateKey`，后端默认时区为 `Asia/Shanghai`，可通过 `APP_TIME_ZONE` 覆盖。

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
- YouTube 搜索结果下载、MP3 转码、封面保存和歌词匹配
- YouTube 粘贴链接导入流程所需的下载接口
- 歌曲删除和运行时文件清理

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
UserStudyDay
UserWordLookup
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

保存用户上传或下载的歌曲：

- title
- artist
- audioUrl
- coverUrl
- lyrics
- lyricsUrl
- sourceType
- sourceUrl
- externalId

`lyrics` 当前以 JSON 字符串保存。`lyricsUrl` 用于关联 YouTube 下载歌曲落盘后的歌词 JSON 文件。`sourceType` 用于区分本地上传歌曲（`upload`）和从 YouTube 下载转换的歌曲（`youtube`）。

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

#### UserStudyDay

按自然日保存学习记录：

- dateKey
- totalSeconds
- learnedSongIds
- lastStudiedAt

`userId + dateKey` 唯一，保证同一个用户每天只有一条聚合记录。

#### UserWordLookup

按用户保存查词热度：

- word
- phonetic
- usPhonetic
- ukPhonetic
- partOfSpeech
- meaning
- lookupCount
- lastLookedUpAt

`userId + word` 唯一，保证同一个用户的同一个单词只保留一条计数记录。

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
DELETE /api/songs/:id
```

`POST /api/songs` 使用 `multipart/form-data` 上传音频、封面和歌词信息。

YouTube 搜索下载流程使用：

```http
GET /api/youtube/search?q=歌曲名
POST /api/youtube/download
```

`GET /api/youtube/search` 会先搜索当前用户的本地曲库；如果命中，返回 `source: local-library`，前端会直接展示本地结果，不再请求 YouTube。如果本地没有命中，再继续走 YouTube 搜索，最多返回 20 条视频结果。

本地曲库搜索返回前会校验 `audioUrl` 对应文件是否存在。如果用户手动删除了文件但数据库记录仍在，后端会清理该孤儿歌曲记录及收藏关联，避免搜索到不可播放歌曲。

`POST /api/youtube/download` 会在后端完成音频下载、MP3 转码、封面保存和歌词匹配。前端不会直接下载 YouTube 视频，而是把 `videoId`、可选标题、可选歌手或频道名传给后端。

从搜索结果下载时，前端会先打开 YouTube 预览弹窗；从剪贴板粘贴 YouTube 链接时，前端也会识别视频 ID 并打开同一套预览弹窗。对于粘贴链接，确认下载后会额外弹出“补充歌曲信息”表单，让用户手动输入歌曲名和歌手名；这两个值会优先用于曲库存储和 LRCLIB 歌词匹配。如果用户跳过或留空，则继续使用 YouTube 元数据。

新下载的 YouTube 歌曲会按歌曲建立目录，将 MP3、封面和歌词 JSON 放在同一个目录下，例如：

```text
server/uploads/youtube/New-Romantics-wyK7YuwUWsU/
  New-Romantics.mp3
  New-Romantics.jpg
  New-Romantics.lyrics.json
```

歌词匹配顺序为：

1. 使用清洗后的 `title + artist/channel + duration` 查询 LRCLIB。
2. 如果 LRCLIB 返回 `syncedLyrics`，解析为带时间轴的歌词。
3. 如果只有 `plainLyrics`，解析为普通歌词并按行生成降级时间点。
4. 如果 LRCLIB 没有结果，再用 `yt-dlp` 尝试下载 YouTube 字幕或自动字幕，并将 VTT 字幕转换为歌词行。
5. 如果以上都失败，歌曲仍会入库，`lyrics` 保存为空数组。

前端下载进度采用阶段式展示：连接 YouTube、提取音频、下载封面、转码 MP3、匹配歌词和写入曲库。当前后端接口是单次长请求，尚未把 `yt-dlp` 的真实字节级进度流式推送到前端，因此完成和失败状态以后端结果为准。

`DELETE /api/songs/:id` 会删除当前用户拥有的歌曲，并同步清理：

- `Song` 数据库记录
- 关联收藏记录
- 本地音频文件
- 封面文件
- 歌词 JSON 文件
- 新版 YouTube 下载歌曲所在的歌曲目录

### 4.5 查词

```http
GET /api/dictionary/:word
```

每次成功查询都会更新当前用户的查词热度计数。

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

### 4.6 查词热度榜

```http
GET /api/word-lookups
```

返回当前用户查询过的所有单词，按 `lookupCount` 从高到低排序：

```json
{
  "words": [
    {
      "word": "apple",
      "phonetic": "/ˈæp.əl/",
      "meaning": "n. 苹果, 家伙",
      "lookupCount": 5,
      "lastLookedUpAt": "2026-05-03T00:00:00.000Z"
    }
  ]
}
```

### 4.7 TTS

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

### 4.8 收藏歌曲

```http
GET /api/favorites
POST /api/favorites
DELETE /api/favorites/:favoriteKey
```

### 4.9 学习统计

```http
POST /api/study/heartbeat
```

请求：

```json
{
  "seconds": 10,
  "songId": "song-id",
  "songTitle": "Someone Like You",
  "dateKey": "2026-05-03"
}
```

后端会创建或更新当天的 `UserStudyDay`，并返回最新统计：

```json
{
  "stats": {
    "cumulativeDays": 1,
    "totalStudySeconds": 120,
    "streakDays": 1,
    "todayStudied": true,
    "studyCurve": []
  }
}
```

### 4.10 生词本

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
APP_TIME_ZONE=Asia/Shanghai

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
- `APP_TIME_ZONE` 用于后端生成学习日期，默认 `Asia/Shanghai`。

## 6. 本地启动

### 6.1 安装依赖

```bash
npm install
```

### 6.2 安装后端系统依赖

YouTube 下载和 MP3 转码由后端完成，因此**运行后端服务的机器**必须安装：

- `yt-dlp`：用于从 YouTube 提取音频。
- `ffmpeg`：用于音频转码为 MP3，并辅助处理封面。

本地 macOS 可使用 Homebrew 安装：

```bash
brew install yt-dlp ffmpeg
```

Linux 服务器或 Docker 环境需要在对应后端运行环境中安装这两个命令，并确保 `yt-dlp` 和 `ffmpeg` 可以被后端进程从 `PATH` 中调用。前端浏览器不需要安装这些工具。

未安装时，普通上传、播放、查词和 TTS 仍可使用，但从 YouTube 下载音乐到曲库的功能不可用。

### 6.3 创建环境变量

复制示例文件：

```bash
cp .env.example .env.local
```

然后填写讯飞密钥。

### 6.4 初始化数据库

```bash
npm run db:generate
npm run db:push
```

### 6.5 下载本地词库

```bash
npm run dict:download
```

该命令会下载完整 ECDICT 到：

```text
server/dictionaries/ecdict.csv
```

文件约 63MB，不会提交到 Git。

### 6.6 启动开发服务

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

### 6.7 生产构建

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
6. 在播放栏选择 `0.5x`、`0.75x` 等倍速，确认歌曲播放速度随之变化。
7. 点击“标准发音”，确认播放美式讯飞 TTS。
8. 点击“美式音标”，确认请求 `en-US`。
9. 点击“英式音标”，确认请求 `en-GB`。
10. 再次点击同一个词，确认后端返回 `cached: true`。
11. 进入发现页，确认“重点词汇卡片”按查词次数排序展示。
12. 点击“查看全部”，确认所有查过的单词按次数从高到低展开。
13. 点击“加入生词本”，确认个人页或词本中出现该词。
14. 点击播放器爱心，确认歌曲出现在个人页收藏列表。
15. 在顶部搜索栏搜索歌曲，确认本地曲库命中时显示“结果来源：本地曲库”，并直接打开本地歌曲。
16. 搜索本地不存在的歌曲，确认 YouTube 结果最多展示 20 条，并显示“结果来源：YouTube”。
17. 点击 YouTube 搜索结果，确认先打开预览弹窗，视频可播放、暂停并拖动进度条。
18. 在页面内粘贴 YouTube 视频链接，确认弹出预览窗口而不是直接下载。
19. 在预览弹窗点击“确认下载”，确认出现“补充歌曲信息”弹窗；填写歌曲名和歌手名后开始下载。
20. 下载过程中确认显示阶段式进度；完成后歌曲进入曲库和底部播放队列。
21. 在底部播放栏点击上一首、下一首、随机和循环按钮，确认可以在上传歌曲和 YouTube 下载歌曲组成的播放列表中切换。
22. 右键歌词行或移动端长按歌词行，确认可编辑歌词并保存。
23. 替换歌词、删除歌曲等确认操作应使用应用内统一弹窗，而不是浏览器原生弹窗。
24. 删除曲库歌曲后，确认数据库记录和本地音频、封面、歌词文件被清理；再次搜索不应返回已删除歌曲。

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
- YouTube 下载依赖后端运行环境中的 `yt-dlp` 和 `ffmpeg`；部署到服务器或容器时也必须安装这两个系统命令。

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
