# MeloMemo
🎵 MeloMemo
Let the melody lead your memory. > 一款专为乐迷打造的沉浸式英文学习 Web 应用。

🌟 项目简介
MeloMemo 旨在打破传统枯燥的英语学习方式。我们相信，最好的语感藏在旋律里。通过结合 Stitch 的极简交互设计，MeloMemo 将每一首英文歌变成了一场视听同步的学习盛宴。

不再是死记硬背，而是随着 Beat 自然掌握。

✨ 核心特性
🎨 Stitch 驱动的沉浸式 UI：利用 Stitch 的响应式组件，打造如丝般顺滑的歌词滚动与交互体验。

🎤 影子跟读模式：内置音频对比算法，实时纠正你的发音，让你像原唱一样地道。

⚡️ 瞬时取词交互：看歌词遇到生词？点击即可弹出 Stitch 风格的优雅气泡窗，查看释义与例句。

📂 智能记忆曲线：基于遗忘曲线，将你收藏的歌词片段转化为“旋律卡片”，强化深度记忆。

🌈 动态氛围感：界面配色随专辑封面颜色智能律动，让学习过程充满视觉愉悦。

🛠️ 技术栈
Frontend: React / Next.js (或其他你使用的框架)

Styling & Components: Stitch (Atomic Design System)

State Management: Zustand / Redux

Audio Engine: Howler.js / Web Audio API

## 科大讯飞在线语音合成 TTS

点击歌词中的英文单词时，前端会调用本地后端 `POST /api/tts` 获取科大讯飞在线语音合成音频。讯飞密钥只读取服务端环境变量，不会暴露到浏览器。

在 `.env.local` 中配置：

```bash
XF_APPID=你的讯飞 APPID
XF_API_KEY=你的讯飞 APIKey
XF_API_SECRET=你的讯飞 APISecret
XF_TTS_EN_US_VOICE=catherine
XF_TTS_EN_GB_VOICE=mary
XF_TTS_SPEED=42
XF_TTS_VOLUME=85
XF_TTS_PITCH=50
```

后端会用 `tts:<lang>:<voice>:<text>:<speed>:<volume>:<pitch>` 生成缓存键，并将 mp3 缓存在 `server/uploads/tts/`。同一个单词、音色和参数再次请求时会直接复用已生成音频。若讯飞接口失败或未配置环境变量，前端只展示错误提示，不再调用浏览器 `speechSynthesis`。

## 本地英汉词库

MeloMemo 支持使用 [ECDICT](https://github.com/skywind3000/ECDICT) 作为本地英汉词库。词库文件不提交到仓库，首次使用前运行：

```bash
npm run dict:download
```

脚本会把完整 `ecdict.csv` 下载到 `server/dictionaries/ecdict.csv`。后端启动时会加载该文件，点击英文单词查询释义时优先使用本地 ECDICT；音标会尽量从在线 `dictionaryapi.dev` 补齐美式和英式两种 IPA。若本地没查到，再回退到在线 `dictionaryapi.dev` 和内置小词典。
