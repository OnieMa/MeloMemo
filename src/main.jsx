import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BarChart, Bar, PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from "recharts";
import { featuredSong, navItems, profileGroups, profileStats, radarData, songs, studyCurve, vocabulary } from "./data";
import { useMeloStore } from "./store";
import "./styles.css";

function parseLyrics(rawText) {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) {
        return false;
      }

      return !/^\[(ti|ar|al|au|by|offset|length|re|ve):[^\]]*\]$/i.test(line);
    });

  const parsed = lines.flatMap((line, index) => {
    const matches = [...line.matchAll(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
    const text = line.replace(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g, "").trim();

    if (matches.length === 0) {
      return [{ id: `plain-${index}`, time: index * 4, text: line }];
    }

    return matches.map((match, matchIndex) => {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = Number((match[3] ?? "0").padEnd(3, "0"));
      return {
        id: `${index}-${matchIndex}`,
        time: minutes * 60 + seconds + fraction / 1000,
        text: text || "♪",
      };
    });
  });

  return parsed.sort((a, b) => a.time - b.time);
}

async function readTextFile(file) {
  return file.text();
}

function getCurrentUserHeaders() {
  const userId = window.localStorage.getItem("melomemo.currentUserId");
  return userId ? { "x-user-id": userId } : {};
}

function getFileKind(file) {
  const name = file.name.toLowerCase();

  if (file.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(name)) {
    return "audio";
  }

  if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(name)) {
    return "cover";
  }

  if (/\.(lrc|txt)$/i.test(name)) {
    return "lyrics";
  }

  return "other";
}

function getFolderKey(file) {
  const relativePath = file.webkitRelativePath || file.name;
  const parts = relativePath.split("/").filter(Boolean);

  if (parts.length <= 2) {
    return parts[0] || "本地导入";
  }

  return parts.slice(0, -1).join("/");
}

function humanizeName(name) {
  return name
    .replace(/\.[^/.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
}

async function buildSongsFromFiles(files) {
  const groups = new Map();

  files.forEach((file) => {
    const kind = getFileKind(file);

    if (kind === "other") {
      return;
    }

    const folderKey = getFolderKey(file);
    const group = groups.get(folderKey) ?? { folderKey };
    group[kind] = group[kind] ?? file;
    groups.set(folderKey, group);
  });

  const songs = [];
  const skipped = [];

  for (const group of groups.values()) {
    if (!group.audio || !group.lyrics) {
      skipped.push(group.folderKey);
      continue;
    }

    const lyricText = await readTextFile(group.lyrics);
    const lyrics = parseLyrics(lyricText);

    if (lyrics.length === 0) {
      skipped.push(group.folderKey);
      continue;
    }

    const folderName = group.folderKey.split("/").at(-1) || "本地歌曲";
    songs.push({
      title: humanizeName(group.audio.name) || folderName,
      artist: folderName,
      audioFile: group.audio,
      coverFile: group.cover,
      lyrics,
    });
  }

  return { songs, skipped };
}

async function uploadSongDraft(song) {
  const formData = new FormData();
  formData.append("title", song.title);
  formData.append("artist", song.artist);
  formData.append("lyrics", JSON.stringify(song.lyrics));
  formData.append("audio", song.audioFile);

  if (song.coverFile) {
    formData.append("cover", song.coverFile);
  }

  const response = await fetch("/api/songs", {
    method: "POST",
    headers: getCurrentUserHeaders(),
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message || `上传失败：${response.status}`);
  }

  const data = await response.json();
  return data.song;
}

function formatTime(value) {
  if (!Number.isFinite(value)) {
    return "0:00";
  }

  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function getLookupWord(token) {
  return token.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/gi, "");
}

function splitLyricText(text) {
  return text.split(/(\s+)/);
}

function countLyricWords(text) {
  return splitLyricText(text).filter((token) => getLookupWord(token)).length;
}

function Icon({ name, filled = false }) {
  return <span className={`material-symbols-outlined ${filled ? "filled" : ""}`}>{name}</span>;
}

function Header() {
  const { view, setView } = useMeloStore();
  return (
    <header className="shell-nav">
      <button className="icon-btn ghost mobile-only" aria-label="展开">
        <Icon name="expand_more" />
      </button>
      <button className="brand" onClick={() => setView("library")}>MeloMemo</button>
      <nav className="desktop-nav" aria-label="主导航">
        {navItems.map((item) => (
          <button key={item.id} className={`nav-link ${view === item.id ? "active" : ""}`} onClick={() => setView(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>
      <div className="nav-actions">
        <button className="icon-btn" aria-label="搜索"><Icon name="search" /></button>
        <button className={`icon-btn ${view === "profile" ? "active-icon" : ""}`} aria-label="个人中心" onClick={() => setView("profile")}><Icon name="person" filled={view === "profile"} /></button>
      </div>
    </header>
  );
}

function LibraryView() {
  const setView = useMeloStore((state) => state.setView);
  const setUploadedSong = useMeloStore((state) => state.setUploadedSong);
  const addLocalSongs = useMeloStore((state) => state.addLocalSongs);
  const localSongs = useMeloStore((state) => state.localSongs);
  const songsStatus = useMeloStore((state) => state.songsStatus);
  const [uploadMessage, setUploadMessage] = useState("");

  const handleUpload = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const audioFile = form.elements.audio.files?.[0];
    const lyricFile = form.elements.lyrics.files?.[0];
    const coverFile = form.elements.cover.files?.[0];
    const title = form.elements.title.value.trim() || audioFile?.name?.replace(/\.[^/.]+$/, "") || "本地歌曲";
    const artist = form.elements.artist.value.trim() || "Local Artist";

    if (!audioFile || !lyricFile) {
      setUploadMessage("请选择歌曲文件和歌词文件。");
      return;
    }

    const lyricText = await readTextFile(lyricFile);
    const lyrics = parseLyrics(lyricText);

    if (lyrics.length === 0) {
      setUploadMessage("歌词文件没有可读取的内容。");
      return;
    }

    try {
      setUploadMessage("正在上传歌曲...");
      const uploaded = await uploadSongDraft({
        title,
        artist,
        audioFile,
        coverFile,
        lyrics,
      });
      addLocalSongs([uploaded]);
      setUploadedSong(uploaded);
      setUploadMessage("");
      form.reset();
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : "上传失败，请确认后端服务已启动。");
    }
  };

  const handleFolderUpload = async (event) => {
    const files = Array.from(event.currentTarget.files ?? []);

    if (files.length === 0) {
      return;
    }

    const result = await buildSongsFromFiles(files);

    if (result.songs.length === 0) {
      setUploadMessage("没有在文件夹中找到可配对的歌曲和歌词文件。");
      event.currentTarget.value = "";
      return;
    }

    setUploadMessage(`正在上传 ${result.songs.length} 首歌曲...`);

    try {
      const uploadedSongs = await Promise.all(result.songs.map(uploadSongDraft));
      addLocalSongs(uploadedSongs);
      setUploadMessage(
        result.skipped.length > 0
          ? `已导入 ${uploadedSongs.length} 首，跳过 ${result.skipped.length} 个缺少歌曲或歌词的文件夹。`
          : `已导入 ${uploadedSongs.length} 首本地歌曲。`,
      );
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : "上传失败，请确认后端服务已启动。");
    }
    event.currentTarget.value = "";
  };

  return (
    <section className="view">
      <div className="hero">
        <img src={featuredSong.cover} alt="演唱会舞台上紫色灯光中的歌手" />
        <div className="hero-content">
          <span className="eyebrow">今日焦点</span>
          <h1>{featuredSong.title}</h1>
          <p>{featuredSong.artist} · {featuredSong.note} · 词汇量 +{featuredSong.words}</p>
          <div className="hero-actions">
            <button className="primary-btn" onClick={() => setView("player")}><Icon name="play_arrow" filled />立即学习</button>
            <button className="glass-btn">加入歌单</button>
          </div>
        </div>
      </div>
      <SectionHead title="分类探索" subtitle="根据你的学习目标选择最适合的曲目" action="查看全部" />
      <div className="category-grid">
        <CategoryCard icon="neurology" title="听歌识词" copy="在律动中快速建立词汇反射" feature />
        <CategoryCard icon="pace" title="慢速英语" copy="发音清晰，适合零基础" />
        <CategoryCard icon="trending_up" title="流行金曲" copy="榜单前沿，语料鲜活" />
      </div>
      <SectionHead title="热门推荐" subtitle="大家都在练的歌曲" />
      <div className="song-grid">
        {songs.map((song) => <SongCard key={song.title} song={song} />)}
        <article className="song-card soundtrack">
          <Icon name="movie" />
          <strong>更多影视原声</strong>
          <button className="mini-btn">立即查看</button>
          <h3>影视原声</h3>
          <p>Soundtracks</p>
        </article>
      </div>

      {localSongs.length > 0 && (
        <>
          <SectionHead title="本地曲库" subtitle="从文件夹导入的歌曲会显示在这里" />
          <div className="song-grid">
            {localSongs.map((song) => (
              <article className="song-card" key={`${song.artist}-${song.title}`}>
                <img src={song.coverUrl || "https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=900&q=80"} alt={`${song.title} 封面`} />
                <button aria-label={`播放 ${song.title}`} onClick={() => setUploadedSong(song)}><Icon name="play_circle" filled /></button>
                <h3>{song.title}</h3>
                <p>{song.artist}</p>
              </article>
            ))}
          </div>
        </>
      )}
      {songsStatus === "loading" && <p className="empty-note local-library-note">正在加载已上传曲库...</p>}
      {songsStatus === "error" && <p className="empty-note local-library-note">暂时无法加载已上传曲库，请确认后端服务已启动。</p>}

      <section className="upload-studio">
        <div>
          <span className="eyebrow dark">Local Studio</span>
          <h2>上传本地歌曲</h2>
          <p>可以选择一个歌曲文件夹，系统会自动识别里面的音频、LRC/文本歌词和封面图。也保留了单文件上传，方便临时试听。</p>
        </div>
        <form className="upload-form" onSubmit={handleUpload}>
          <label className="folder-picker">
            <span>批量导入文件夹</span>
            <input type="file" webkitdirectory="true" directory="true" multiple onChange={handleFolderUpload} />
          </label>
          <label>
            <span>歌曲名称</span>
            <input name="title" type="text" placeholder="例如：My Song" />
          </label>
          <label>
            <span>歌手</span>
            <input name="artist" type="text" placeholder="例如：Local Artist" />
          </label>
          <label>
            <span>歌曲文件</span>
            <input name="audio" type="file" accept="audio/*" />
          </label>
          <label>
            <span>歌词文件</span>
            <input name="lyrics" type="file" accept=".lrc,.txt,text/plain" />
          </label>
          <label>
            <span>封面图</span>
            <input name="cover" type="file" accept="image/*" />
          </label>
          <button className="primary-btn" type="submit"><Icon name="upload_file" />上传并播放</button>
          {uploadMessage && <p className="form-message">{uploadMessage}</p>}
        </form>
      </section>
    </section>
  );
}

function SectionHead({ title, subtitle, action }) {
  return (
    <section className="section-head">
      <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
      {action && <button className="text-btn">{action}<Icon name="chevron_right" /></button>}
    </section>
  );
}

function CategoryCard({ icon, title, copy, feature = false }) {
  return <article className={`category-card ${feature ? "feature" : ""}`}><Icon name={icon} /><h3>{title}</h3><p>{copy}</p></article>;
}

function SongCard({ song }) {
  const setView = useMeloStore((state) => state.setView);
  return (
    <article className="song-card">
      <img src={song.cover} alt={`${song.title} 专辑氛围图`} />
      <button aria-label={`播放 ${song.title}`} onClick={() => setView("player")}><Icon name="play_circle" filled /></button>
      <h3>{song.title}</h3>
      <p>{song.artist}</p>
    </article>
  );
}

function PlayerView({ showLyrics = true }) {
  const { activeWord, isPlaying, isRecording, setPlaying, togglePlaying, toggleRecording, toggleWord, saveWord, savedWords, uploadedSong, pendingSeekTime, consumePendingSeekTime, favoriteSongs, toggleFavoriteSong } = useMeloStore();
  const audioRef = useRef(null);
  const activeLyricRef = useRef(null);
  const syncedLyricsRef = useRef(null);
  const progressTrackRef = useRef(null);
  const volumeTrackRef = useRef(null);
  const dragStateRef = useRef(null);
  const isSeekingRef = useRef(false);
  const isVolumeDraggingRef = useRef(false);
  const ttsAudioRef = useRef(null);
  const singerAudioRef = useRef(null);
  const singerStopTimerRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(225);
  const [volume, setVolume] = useState(0.7);
  const [recordPosition, setRecordPosition] = useState(null);
  const [wordPopover, setWordPopover] = useState(null);
  const isEchoesOpen = activeWord === "echoes";
  const hasEchoes = savedWords.some((item) => item.word === "echoes");
  const defaultLyrics = useMemo(
    () => [
      { id: "prev", time: 0, text: "The mountains are calling me back home" },
      { id: "active", time: 8, text: "Where the echoes fade away" },
      { id: "next", time: 16, text: "Searching for a reason to stay" },
      { id: "far", time: 24, text: "But the wind is blowing cold tonight" },
    ],
    [],
  );
  const currentSong = useMemo(
    () => ({
      id: uploadedSong?.id,
      title: uploadedSong?.title || "Ethereal Echoes",
      artist: uploadedSong?.artist || "Lyrical Soul",
      audioUrl: uploadedSong?.audioUrl,
      coverUrl: uploadedSong?.coverUrl || "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&w=300&q=80",
      lyrics: uploadedSong?.lyrics || defaultLyrics,
    }),
    [defaultLyrics, uploadedSong],
  );
  const currentSongFavoriteId = currentSong.id
    ? `id:${currentSong.id}`
    : `song:${currentSong.title.trim().toLowerCase()}::${currentSong.artist.trim().toLowerCase()}`;
  const isCurrentSongFavorite = favoriteSongs.some((song) => song.favoriteId === currentSongFavoriteId);
  const lyricLines = uploadedSong?.lyrics?.length ? uploadedSong.lyrics : defaultLyrics;
  const getActiveLineIndex = (time) => lyricLines.reduce(
    (activeIndex, line, index) => (time >= line.time ? index : activeIndex),
    0,
  );
  const activeLineIndex = getActiveLineIndex(currentTime);
  const syncLyricsToTime = (time, behavior = "smooth") => {
    const container = syncedLyricsRef.current;

    if (!container) {
      return;
    }

    const nextIndex = getActiveLineIndex(time);
    const activeLine = container.querySelector(`[data-lyric-index="${nextIndex}"]`);

    if (!activeLine) {
      return;
    }

    const nextTop = activeLine.offsetTop - container.clientHeight / 2 + activeLine.clientHeight / 2;
    container.scrollTo({
      top: Math.max(0, nextTop),
      behavior,
    });
  };
  const seekToClientX = (clientX) => {
    const track = progressTrackRef.current;

    if (!track) {
      return;
    }

    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const nextTime = ratio * duration;

    setCurrentTime(nextTime);
    if (audioRef.current) {
      audioRef.current.currentTime = nextTime;
    }
    requestAnimationFrame(() => syncLyricsToTime(nextTime, "auto"));
  };

  const startSeeking = (event) => {
    isSeekingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    seekToClientX(event.clientX);
  };

  const setVolumeFromClientX = (clientX) => {
    const track = volumeTrackRef.current;

    if (!track) {
      return;
    }

    const rect = track.getBoundingClientRect();
    const nextVolume = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setVolume(nextVolume);
    if (audioRef.current) {
      audioRef.current.volume = nextVolume;
    }
  };

  const startVolumeDragging = (event) => {
    isVolumeDraggingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setVolumeFromClientX(event.clientX);
  };

  const restoreSongVolume = () => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  };

  const duckSongVolume = (targetVolume = 0.18) => {
    if (audioRef.current) {
      audioRef.current.volume = Math.min(volume, targetVolume);
    }
  };

  const stopAudioRef = (audioRefToStop) => {
    if (!audioRefToStop.current) {
      return;
    }

    audioRefToStop.current.pause();
    audioRefToStop.current.src = "";
    audioRefToStop.current = null;
  };

  const getTtsAccentLabel = (lang = "en-US") => (lang === "en-GB" ? "英式" : "美式");

  const pronounceWord = async (word, lang = "en-US") => {
    stopAudioRef(ttsAudioRef);

    setWordPopover((current) =>
      current?.word === word ? { ...current, ttsStatus: "loading", ttsError: "", ttsMeta: { lang } } : current,
    );
    duckSongVolume(0.14);

    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: word,
          lang,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.message || "讯飞 TTS 暂时不可用。");
      }

      const data = await response.json();
      if (!data.url) {
        throw new Error("讯飞 TTS 没有返回音频地址。");
      }

      const pronunciationAudio = new Audio(data.url);
      ttsAudioRef.current = pronunciationAudio;
      pronunciationAudio.volume = 1;
      pronunciationAudio.onended = restoreSongVolume;
      pronunciationAudio.onerror = () => {
        restoreSongVolume();
        setWordPopover((current) =>
          current?.word === word ? { ...current, ttsStatus: "error", ttsError: `讯飞${getTtsAccentLabel(lang)}音频播放失败，请稍后重试。` } : current,
        );
      };
      await pronunciationAudio.play();

      setWordPopover((current) =>
        current?.word === word
          ? {
              ...current,
              ttsStatus: "ready",
              ttsMeta: {
                cached: Boolean(data.cached),
                engine: data.engine,
                lang: data.lang || lang,
                voice: data.voice,
              },
            }
          : current,
      );
    } catch (error) {
      setWordPopover((current) =>
        current?.word === word
          ? {
              ...current,
              ttsStatus: "error",
              ttsError: error instanceof Error ? error.message : `讯飞${getTtsAccentLabel(lang)}发音暂时不可用。`,
            }
          : current,
      );
      restoreSongVolume();
    }
  };

  const getLineEndTime = (line) => {
    const lineIndex = lyricLines.findIndex((item) => item.id === line?.id);
    const nextLine = lineIndex >= 0 ? lyricLines[lineIndex + 1] : null;

    if (nextLine?.time > line.time) {
      return nextLine.time;
    }

    return Math.min(duration || line.time + 3.2, line.time + 3.2);
  };

  const getWordTiming = (line, wordIndex, wordCount) => {
    if (!line || typeof line.time !== "number") {
      return {
        wordTime: currentTime,
        clipStartTime: Math.max(0, currentTime - 0.25),
        clipEndTime: currentTime + 1.2,
      };
    }

    const lineEndTime = getLineEndTime(line);
    const lineDuration = Math.max(0.9, lineEndTime - line.time);
    const safeWordCount = Math.max(1, wordCount);
    const wordStep = lineDuration / safeWordCount;
    const wordTime = line.time + wordStep * (wordIndex + 0.5);

    return {
      wordTime,
      clipStartTime: Math.max(0, wordTime - Math.min(0.22, wordStep * 0.4)),
      clipEndTime: Math.min(lineEndTime, wordTime + Math.max(0.65, wordStep * 1.25)),
    };
  };

  const playSingerWord = () => {
    if (!uploadedSong?.audioUrl || !wordPopover?.clipStartTime) {
      setWordPopover((current) =>
        current ? { ...current, singerStatus: "error", singerError: "请先选择一首本地歌曲，才能播放原唱慢放。" } : current,
      );
      return;
    }

    stopAudioRef(singerAudioRef);
    if (singerStopTimerRef.current) {
      window.clearTimeout(singerStopTimerRef.current);
    }

    const clipAudio = new Audio(uploadedSong.audioUrl);
    const startTime = wordPopover.clipStartTime;
    const endTime = Math.max(startTime + 0.75, wordPopover.clipEndTime || startTime + 1.2);
    singerAudioRef.current = clipAudio;
    clipAudio.volume = 1;
    clipAudio.playbackRate = 0.65;
    clipAudio.preservesPitch = true;
    clipAudio.mozPreservesPitch = true;
    clipAudio.webkitPreservesPitch = true;
    clipAudio.preload = "auto";
    duckSongVolume(0.1);
    setWordPopover((current) =>
      current ? { ...current, singerStatus: "loading", singerError: "" } : current,
    );

    const stopSingerClip = () => {
      if (singerStopTimerRef.current) {
        window.clearTimeout(singerStopTimerRef.current);
        singerStopTimerRef.current = null;
      }

      stopAudioRef(singerAudioRef);
      restoreSongVolume();
      setWordPopover((current) =>
        current ? { ...current, singerStatus: "ready" } : current,
      );
    };

    clipAudio.ontimeupdate = () => {
      if (clipAudio.currentTime >= endTime) {
        stopSingerClip();
      }
    };
    clipAudio.onerror = () => {
      restoreSongVolume();
      setWordPopover((current) =>
        current ? { ...current, singerStatus: "error", singerError: "原唱片段暂时无法播放。" } : current,
      );
    };

    const startClip = async () => {
      try {
        clipAudio.currentTime = startTime;
        await clipAudio.play();
        setWordPopover((current) =>
          current ? { ...current, singerStatus: "playing" } : current,
        );
        singerStopTimerRef.current = window.setTimeout(
          stopSingerClip,
          Math.max(1200, ((endTime - startTime) / 0.65) * 1000 + 300),
        );
      } catch {
        restoreSongVolume();
        setWordPopover((current) =>
          current ? { ...current, singerStatus: "error", singerError: "原唱慢放被浏览器拦截或音频未就绪。" } : current,
        );
      }
    };

    if (clipAudio.readyState >= 1) {
      startClip();
    } else {
      clipAudio.addEventListener("loadedmetadata", startClip, { once: true });
      clipAudio.load();
    }
  };

  const openWordPopover = async (event, rawWord, occurrence) => {
    const word = getLookupWord(rawWord);

    if (!word) {
      return;
    }

    const line = occurrence?.line;
    const timing = occurrence
      ? getWordTiming(occurrence.line, occurrence.wordIndex, occurrence.wordCount)
      : getWordTiming(line, 0, 1);
    const rect = event.currentTarget.getBoundingClientRect();
    const sourceSong = uploadedSong?.title || "Ethereal Echoes";
    setWordPopover({
      word,
      x: Math.min(window.innerWidth - 340, Math.max(18, rect.left + rect.width / 2 - 160)),
      y: Math.min(window.innerHeight - 280, Math.max(100, rect.bottom + 12)),
      status: "loading",
      sourceSong,
      sourceSongId: uploadedSong?.id,
      sourceTime: timing.wordTime,
      sourceLine: line?.text || rawWord,
      clipStartTime: timing.clipStartTime,
      clipEndTime: timing.clipEndTime,
      saveStatus: "idle",
      ttsStatus: "idle",
      singerStatus: "idle",
    });
    void pronounceWord(word);

    try {
      const response = await fetch(`/api/dictionary/${encodeURIComponent(word)}`);
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.message || "查询失败");
      }
      const data = await response.json();
      setWordPopover((current) =>
        current?.word === word
          ? { ...current, status: "ready", data }
          : current,
      );
    } catch (error) {
      setWordPopover((current) =>
        current?.word === word
          ? {
              ...current,
              status: "error",
              error: error instanceof Error ? error.message : "查询失败",
            }
          : current,
      );
    }
  };

  const addPopoverWordToVocabulary = async () => {
    if (!wordPopover || wordPopover.status !== "ready" || !wordPopover.data?.meaning) {
      return;
    }

    const currentWord = wordPopover.word;
    setWordPopover((current) =>
      current?.word === currentWord ? { ...current, saveStatus: "saving" } : current,
    );

    await saveWord({
      word: currentWord,
      phonetic: wordPopover.data.usPhonetic || wordPopover.data.phonetic,
      meaning: wordPopover.data.meaning,
      example: wordPopover.data.example,
      sourceSong: wordPopover.sourceSong,
      sourceSongId: wordPopover.sourceSongId,
      sourceTime: wordPopover.sourceTime,
      sourceLine: wordPopover.sourceLine,
    });

    setWordPopover((current) =>
      current?.word === currentWord ? { ...current, saveStatus: "saved" } : current,
    );
  };

  const renderClickableLyric = (text, line) => {
    const wordCount = countLyricWords(text);
    let wordIndex = -1;

    return splitLyricText(text).map((token, index) => {
      const word = getLookupWord(token);

      if (!word) {
        return token;
      }

      wordIndex += 1;
      return (
        <button className="lyric-word" key={`${token}-${index}`} type="button" onClick={(event) => openWordPopover(event, token, { line, wordIndex, wordCount })}>
          {token}
        </button>
      );
    });
  };

  useEffect(() => {
    if (!audioRef.current || !uploadedSong?.audioUrl) {
      return;
    }

    audioRef.current.volume = volume;

    if (isPlaying) {
      audioRef.current.play().catch(() => setPlaying(false));
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying, setPlaying, uploadedSong?.audioUrl, volume]);

  useEffect(() => {
    if (pendingSeekTime === null || !uploadedSong?.audioUrl) {
      return;
    }

    const seekTime = pendingSeekTime;
    const audio = audioRef.current;
    consumePendingSeekTime();
    setCurrentTime(seekTime);
    requestAnimationFrame(() => syncLyricsToTime(seekTime, "auto"));

    if (!audio) {
      return;
    }

    const applySeek = () => {
      audio.currentTime = seekTime;
      setCurrentTime(seekTime);
      requestAnimationFrame(() => syncLyricsToTime(seekTime, "auto"));
    };

    if (audio.readyState >= 1) {
      applySeek();
      return;
    }

    audio.addEventListener("loadedmetadata", applySeek, { once: true });
    return () => audio.removeEventListener("loadedmetadata", applySeek);
  }, [pendingSeekTime, uploadedSong?.audioUrl, consumePendingSeekTime]);

  useLayoutEffect(() => {
    const container = syncedLyricsRef.current;
    const activeLine = activeLyricRef.current;

    if (!container || !activeLine) {
      return;
    }

    const nextTop = activeLine.offsetTop - container.clientHeight / 2 + activeLine.clientHeight / 2;
    container.scrollTo({
      top: Math.max(0, nextTop),
      behavior: isSeekingRef.current ? "auto" : "smooth",
    });
  }, [activeLineIndex, uploadedSong?.id, uploadedSong?.title]);

  useEffect(() => {
    const handlePointerMove = (event) => {
      if (!isSeekingRef.current) {
        return;
      }

      seekToClientX(event.clientX);
    };

    const stopSeeking = () => {
      isSeekingRef.current = false;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopSeeking);
    window.addEventListener("pointercancel", stopSeeking);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopSeeking);
      window.removeEventListener("pointercancel", stopSeeking);
    };
  }, [duration]);

  useEffect(() => {
    const handlePointerMove = (event) => {
      if (!isVolumeDraggingRef.current) {
        return;
      }

      setVolumeFromClientX(event.clientX);
    };

    const stopDragging = () => {
      isVolumeDraggingRef.current = false;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, []);

  useEffect(() => {
    const placeDefaultRecorder = () => {
      setRecordPosition((position) => {
        if (position?.isCustom) {
          return position;
        }

        const lyricWidth = Math.min(880, window.innerWidth - 32);
        const left = Math.min(
          window.innerWidth - 122,
          window.innerWidth / 2 + lyricWidth / 2 + 36,
        );
        return {
          x: Math.max(18, left),
          y: Math.max(120, window.innerHeight * 0.42),
          isCustom: false,
        };
      });
    };

    placeDefaultRecorder();
    window.addEventListener("resize", placeDefaultRecorder);
    return () => window.removeEventListener("resize", placeDefaultRecorder);
  }, []);

  useEffect(() => {
    const handlePointerMove = (event) => {
      if (!dragStateRef.current) {
        return;
      }

      const nextX = event.clientX - dragStateRef.current.offsetX;
      const nextY = event.clientY - dragStateRef.current.offsetY;

      setRecordPosition({
        x: Math.min(Math.max(12, nextX), window.innerWidth - 104),
        y: Math.min(Math.max(104, nextY), window.innerHeight - 260),
        isCustom: true,
      });
    };

    const stopDragging = () => {
      dragStateRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, []);

  const startRecorderDrag = (event) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    dragStateRef.current = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  return (
    <>
      {uploadedSong?.audioUrl && (
        <audio
          ref={audioRef}
          src={uploadedSong.audioUrl}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 225)}
          onEnded={() => setPlaying(false)}
        />
      )}
      {showLyrics && (
      <section className="view player-view">
        <div className={`lyric-stage ${uploadedSong ? "synced" : ""}`}>
          {uploadedSong ? (
            <div className="synced-lyrics" ref={syncedLyricsRef}>
              {lyricLines.map((line, index) => (
                <p
                  key={line.id}
                  ref={index === activeLineIndex ? activeLyricRef : null}
                  data-lyric-index={index}
                  className={`synced-line ${index === activeLineIndex ? "active" : ""}`}
                >
                  {renderClickableLyric(line.text, line)}
                </p>
              ))}
            </div>
          ) : (
            <>
            <p className="lyric muted">{renderClickableLyric(defaultLyrics[0].text, defaultLyrics[0])}</p>
              <div className="active-lyric">
                <h1>
                  Where the{" "}
                  <button className={`smart-word ${isEchoesOpen ? "is-open" : ""}`} type="button" aria-expanded={isEchoesOpen} onClick={() => {
                    toggleWord("echoes");
                    void pronounceWord("echoes");
                  }}>
                    echoes
                  </button>{" "}
                  fade away
                </h1>
                {isEchoesOpen && (
                  <aside className="word-popover">
                    <div><span>SmartWord</span><button className="icon-btn tiny" aria-label="发音" onClick={() => pronounceWord("echoes")}><Icon name="volume_up" filled /></button></div>
                    <h2>echoes</h2>
                    <p>/ˈekoʊz/ · n. 回声，共鸣</p>
                    <em>"The walls repeat the echoes of our past."</em>
                    <button className="primary-btn small" onClick={() => saveWord({
                      word: "echoes",
                      phonetic: "/ˈekoʊz/",
                      meaning: "n. 回声，共鸣",
                      example: "The walls repeat the echoes of our past.",
                      sourceSong: "Ethereal Echoes",
                    })}>
                      {hasEchoes ? "已加入" : "加入生词本"}
                    </button>
                  </aside>
                )}
              </div>
            <p className="lyric next">{renderClickableLyric(defaultLyrics[2].text, defaultLyrics[2])}</p>
            <p className="lyric far">{renderClickableLyric(defaultLyrics[3].text, defaultLyrics[3])}</p>
          </>
        )}
        </div>
      </section>
      )}
      {showLyrics && wordPopover && (
        <aside className="click-word-popover" style={{ left: wordPopover.x, top: wordPopover.y }}>
          <div className="click-word-head">
            <span>SmartWord</span>
            <button className="icon-btn tiny" aria-label="标准发音" onClick={() => pronounceWord(wordPopover.word)}><Icon name="volume_up" filled /></button>
            <button className="icon-btn tiny" aria-label="关闭" onClick={() => setWordPopover(null)}><Icon name="close" /></button>
          </div>
          <h2>{wordPopover.word}</h2>
          {wordPopover.status === "loading" && <p>正在查询释义...</p>}
          {wordPopover.status === "error" && <p>{wordPopover.error}</p>}
          {wordPopover.status === "ready" && (
            <>
              <div className="word-phonetic">
                <button type="button" className="phonetic-choice" onClick={() => pronounceWord(wordPopover.word, "en-US")}>
                  <span>美式</span>
                  <strong>{wordPopover.data?.usPhonetic || wordPopover.data?.phonetic || "暂无音标"}</strong>
                </button>
                <button type="button" className="phonetic-choice" onClick={() => pronounceWord(wordPopover.word, "en-GB")}>
                  <span>英式</span>
                  <strong>{wordPopover.data?.ukPhonetic || wordPopover.data?.phonetic || "暂无音标"}</strong>
                </button>
              </div>
              <p className="word-meta">词性：{wordPopover.data?.partOfSpeech || "未标注"}</p>
              <strong>{wordPopover.data?.meaning}</strong>
              {wordPopover.data?.example && <em>"{wordPopover.data.example}"</em>}
              <div className="word-audio-actions">
                <button className="audio-pill" type="button" onClick={() => pronounceWord(wordPopover.word)}>
                  <Icon name="record_voice_over" />标准发音
                </button>
                <button className="audio-pill" type="button" onClick={playSingerWord} disabled={!uploadedSong?.audioUrl}>
                  <Icon name="slow_motion_video" />原唱慢放
                </button>
              </div>
              {wordPopover.ttsStatus === "loading" && <small className="word-audio-status">正在生成讯飞发音...</small>}
              {wordPopover.ttsStatus === "ready" && (
                <small className="word-audio-status">
                  {getTtsAccentLabel(wordPopover.ttsMeta?.lang)}发音：科大讯飞 TTS · {wordPopover.ttsMeta?.voice || "默认英文音色"}{wordPopover.ttsMeta?.cached ? " · 已缓存" : ""}
                </small>
              )}
              {wordPopover.ttsStatus === "error" && <small className="word-audio-status warning">{wordPopover.ttsError}</small>}
              {wordPopover.singerStatus === "playing" && <small className="word-audio-status">正在播放原唱 0.65x 慢放...</small>}
              {wordPopover.singerStatus === "ready" && <small className="word-audio-status">原唱片段已播放完毕。</small>}
              {wordPopover.singerStatus === "error" && <small className="word-audio-status warning">{wordPopover.singerError}</small>}
              {wordPopover.sourceSong && (
                <small className="word-source">
                  来源：{wordPopover.sourceSong} · {formatTime(wordPopover.sourceTime || 0)}
                </small>
              )}
              <small>释义：{wordPopover.data?.source} · 默认发音：科大讯飞 TTS / en-US，美式英语</small>
              <button className="primary-btn word-save-btn" type="button" onClick={addPopoverWordToVocabulary}>
                {wordPopover.saveStatus === "saving"
                  ? "正在加入..."
                  : wordPopover.saveStatus === "saved" || savedWords.some((item) => item.word === wordPopover.word)
                    ? "已加入生词本"
                    : "加入生词本"}
              </button>
            </>
          )}
        </aside>
      )}
      {showLyrics && (
      <div
        className={`record-widget ${isRecording ? "recording" : ""}`}
        style={recordPosition ? { left: recordPosition.x, top: recordPosition.y } : undefined}
        aria-label="录音练习"
        onPointerDown={startRecorderDrag}
      >
        <div className="wave-stack"><span /><span /><span /><span /><span /></div>
        <button className="record-btn" aria-label="长按录音纠音" onClick={toggleRecording} onPointerDown={(event) => event.stopPropagation()}><Icon name={isRecording ? "stop" : "mic"} filled /></button>
        <strong>{isRecording ? "正在录音" : "长按录音纠音"}</strong>
      </div>
      )}
      <footer className="player-bar">
        <div className="control-glass">
          <div className="progress-row">
            <span>{formatTime(uploadedSong ? currentTime : 134)}</span>
            <div className="track seekable" ref={progressTrackRef} onPointerDown={startSeeking} role="slider" aria-valuemin="0" aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(uploadedSong ? currentTime : 134)} tabIndex="0">
              <i style={{ width: `${Math.min(100, ((uploadedSong ? currentTime : 146) / duration) * 100)}%` }} />
              <b style={{ left: `${Math.min(100, ((uploadedSong ? currentTime : 146) / duration) * 100)}%` }} />
            </div>
            <span>{formatTime(duration)}</span>
          </div>
          <div className="now-playing">
            <img src={currentSong.coverUrl} alt="当前歌曲封面" />
            <div><strong>{currentSong.title}</strong><span>{currentSong.artist}</span></div>
          </div>
          <div className="transport">
            <button className="icon-btn ghost" aria-label="随机"><Icon name="shuffle" /></button>
            <button className="icon-btn ghost" aria-label="上一首"><Icon name="skip_previous" /></button>
            <button className="play-btn" aria-label={isPlaying ? "暂停" : "播放"} onClick={togglePlaying}><Icon name={isPlaying ? "pause" : "play_arrow"} filled /></button>
            <button className="icon-btn ghost" aria-label="下一首"><Icon name="skip_next" /></button>
            <button className="icon-btn ghost" aria-label="循环"><Icon name="repeat" /></button>
          </div>
          <div className="volume">
            <button
              className={`icon-btn ghost favorite-btn ${isCurrentSongFavorite ? "saved" : ""}`}
              type="button"
              aria-label={isCurrentSongFavorite ? "取消收藏当前歌曲" : "收藏当前歌曲"}
              aria-pressed={isCurrentSongFavorite}
              onClick={() => toggleFavoriteSong(currentSong)}
              title={isCurrentSongFavorite ? "已收藏" : "收藏歌曲"}
            >
              <Icon name="favorite" filled={isCurrentSongFavorite} />
            </button>
            <Icon name={volume === 0 ? "volume_off" : "volume_up"} />
            <div className="volume-track seekable" ref={volumeTrackRef} onPointerDown={startVolumeDragging} role="slider" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(volume * 100)} tabIndex="0">
              <i style={{ width: `${volume * 100}%` }} />
              <b style={{ left: `${volume * 100}%` }} />
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}

function DiscoverView() {
  const { savedWords, vocabularyStatus, localSongs, openSongAtTime } = useMeloStore();
  return (
    <section className="view">
      <section className="overview-panel">
        <h1>词汇掌握概览</h1>
        <p>你已经通过 12 首歌曲掌握了以下语言成就。</p>
        <div className="stat-grid">
          <div><span>总掌握词汇</span><strong>1,428</strong></div>
          <div><span>已攻克难句</span><strong>86</strong></div>
          <div><span>学习时长</span><strong>14h 20m</strong></div>
          <div><span>发音准确度</span><strong>94%</strong></div>
        </div>
      </section>
      <div className="learning-grid">
        <section className="word-list">
          <div className="section-head compact"><h2>重点词汇卡片</h2><button className="text-btn">查看全部</button></div>
          {vocabulary.map(([word, meaning]) => <article key={word}><div><h3>{word}</h3><p>{meaning}</p></div><button className="icon-btn"><Icon name="volume_up" /></button></article>)}
        </section>
        <aside className="challenge-card">
          <Icon name="psychology" />
          <h2>今日难句挑战</h2>
          <blockquote>"The ethereal velocity of the night sky echoes through my soul."</blockquote>
          <p>夜空的缥缈速度在我的灵魂中回响。</p>
          <div><button className="primary-btn light"><Icon name="play_arrow" />播放原声</button><button className="glass-btn"><Icon name="mic" />开始跟读</button></div>
        </aside>
      </div>
      <section className="saved-vocabulary">
        <SectionHead title="我的生词本" subtitle="从歌词中点击收藏的单词会同步保存在这里" />
        {vocabularyStatus === "loading" && <p className="empty-note">正在读取生词本...</p>}
        {vocabularyStatus === "error" && <p className="empty-note">暂时无法连接生词本服务，请确认后端已启动。</p>}
        {vocabularyStatus !== "loading" && savedWords.length === 0 && (
          <p className="empty-note">还没有收藏单词。去歌词掌握页点击 SmartWord，把第一个单词放进来。</p>
        )}
        {savedWords.length > 0 && (
          <div className="saved-word-grid">
            {savedWords.map((item) => {
              const sourceSong = item.sourceSongId
                ? localSongs.find((song) => song.id === item.sourceSongId)
                : null;

              return (
                <article className="saved-word-card" key={item.word}>
                  <div>
                    <span>SmartWord</span>
                    <h3>{item.word}</h3>
                    <p>{item.phonetic || "暂无音标"} · {item.meaning}</p>
                  </div>
                  {item.example && <em>"{item.example}"</em>}
                  {item.sourceLine && <em className="source-line">"{item.sourceLine}"</em>}
                  {item.sourceSong && <small>{item.sourceSong}{typeof item.sourceTime === "number" ? ` · ${formatTime(item.sourceTime)}` : ""}</small>}
                  {item.sourceSongId && (
                    <button
                      className="word-jump-btn"
                      type="button"
                      disabled={!sourceSong}
                      onClick={() => sourceSong && openSongAtTime(sourceSong, item.sourceTime)}
                    >
                      {sourceSong ? "跳转到歌词位置" : "本地歌曲未加载"}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}

function ProgressView() {
  return (
    <section className="view">
      <div className="progress-top">
        <article className="metric-card"><Icon name="local_fire_department" filled /><p>连续学习</p><h2>15 <small>天</small></h2><div className="mini-days"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span></div></article>
        <article className="metric-card primary"><p>累计时长</p><h2>128 <small>小时</small></h2><span>相当于通过音乐记住了 1,420 个核心词汇</span></article>
        <article className="metric-card ring-card"><p>掌握程度</p><div className="ring"><strong>75%</strong></div><span>白银等级 · 节奏大师</span></article>
      </div>
      <div className="chart-grid">
        <section className="chart-card">
          <div className="section-head compact"><div><h2>学习曲线</h2><p>过去 30 天的旋律记忆波动</p></div><div className="segmented"><button>周</button><button>月</button></div></div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={studyCurve}><Bar dataKey="minutes" radius={[16, 16, 0, 0]} fill="url(#barGradient)" /><defs><linearGradient id="barGradient" x1="0" x2="0" y1="0" y2="1"><stop stopColor="var(--primary)" /><stop offset="1" stopColor="var(--secondary-soft)" /></linearGradient></defs></BarChart>
          </ResponsiveContainer>
          <div className="axis">{studyCurve.map((item) => <span key={item.day}>{item.day}</span>)}</div>
        </section>
        <section className="chart-card radar-card">
          <h2>能力雷达图</h2>
          <ResponsiveContainer width="100%" height={250}>
            <RadarChart data={radarData}><PolarGrid stroke="var(--outline)" /><PolarAngleAxis dataKey="skill" tick={{ fill: "var(--muted)", fontSize: 12 }} /><Radar dataKey="value" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.35} /></RadarChart>
          </ResponsiveContainer>
          <div className="radar-meta"><p><span>最强项</span><strong>旋律听辨</strong></p><p><span>待加强</span><strong>复杂语法</strong></p></div>
        </section>
      </div>
      <section className="honors">
        <SectionHead title="荣誉墙" subtitle="记录你每一个闪耀的瞬间" />
        <div className="honor-grid">
          {["初试啼声", "学习先锋", "百词斩", "填词达人"].map((title, index) => <article key={title} className={index === 3 ? "locked" : ""}><Icon name={["auto_awesome", "timer_10_alt_1", "verified", "lyrics"][index]} filled={index < 3} /><strong>{title}</strong><small>{["完成第 1 首歌", "累计 10 小时", "掌握 100 词汇", "解锁 50 首全词"][index]}</small></article>)}
        </div>
      </section>
    </section>
  );
}

function ProfileView() {
  const { currentUser, profileStats: accountStats, profileStatus, favoriteSongs, setUploadedSong, setView } = useMeloStore();
  const profileStatsWithFavorites = profileStats.map((stat) =>
    stat.label === "累计学习(天)"
      ? { ...stat, value: String(accountStats?.cumulativeDays ?? stat.value) }
      : stat.label === "掌握单词"
        ? { ...stat, value: (accountStats?.masteredWords ?? stat.value).toLocaleString() }
        : stat.label === "攻克难句"
          ? { ...stat, value: String(accountStats?.conqueredSentences ?? stat.value) }
          : stat.label === "收藏歌曲"
            ? { ...stat, value: String(accountStats?.favoriteSongs ?? favoriteSongs.length) }
            : stat,
  );
  const playFavoriteSong = (song) => {
    if (song.audioUrl && song.lyrics?.length) {
      setUploadedSong({
        id: song.id,
        title: song.title,
        artist: song.artist,
        audioUrl: song.audioUrl,
        coverUrl: song.coverUrl,
        lyrics: song.lyrics,
      });
      return;
    }

    setView("player");
  };

  return (
    <section className="view profile-view">
      <div className="profile-main">
        <div className="profile-left">
          <section className="profile-hero-card">
            <div className="avatar-wrap">
              <img
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuBUysvjdILh1cXFtHAS32MsdeoPUxMUQui-iBosnBkTcRUVWczqZBdf4NjfRqwB-oKLn7iXPkERDhTXs4BkURjp-NBtVQxBvSDzGXuiPLUdWNMo37HDg6LQcDtr41Zk2CF73lUXrvLrCzsQvPZk8V6O2Kpgf9hq4FNVCkdtttae7ZW0Q0l3VsZDPKh-zvmv8O6nycuhNQ1jsEVPC8BAUPPwQ2ZwjB6SsDg-bQxyEVX6_5l-IfJpCmpPlqbu-_F2b5mGyQ8rDEHAu3Pb"
                alt="用户头像"
              />
              <span><Icon name="music_note" filled /></span>
            </div>
            <div className="profile-copy">
              <h1>{currentUser?.displayName || "音律旅人"}</h1>
              <span className="level-chip">{currentUser?.levelTitle || "LV.4 节奏大师"}</span>
              <p>"{currentUser?.bio || "在旋律中寻找灵魂的共鸣"}"</p>
            </div>
          </section>

          <section className="profile-stats">
            {profileStatus === "error" && <p className="empty-note profile-empty-note">暂时无法读取账户统计。</p>}
            {profileStatsWithFavorites.map((stat) => (
              <article key={stat.label} className={`profile-stat ${stat.tone}`}>
                <Icon name={stat.icon} filled={stat.icon === "favorite"} />
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </article>
            ))}
          </section>

          <section className="favorite-songs-panel">
            <div className="section-head compact">
              <h2>我的收藏</h2>
              <button className="text-btn" type="button" onClick={() => setView("player")}>继续播放</button>
            </div>
            {favoriteSongs.length > 0 ? (
              <div className="favorite-song-list">
                {favoriteSongs.map((song) => (
                  <button className="favorite-song-row" type="button" key={song.favoriteId} onClick={() => playFavoriteSong(song)}>
                    <img src={song.coverUrl || "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&w=300&q=80"} alt={`${song.title} 封面`} />
                    <span>
                      <strong>{song.title}</strong>
                      <small>{song.artist}</small>
                    </span>
                    <Icon name="play_arrow" filled />
                  </button>
                ))}
              </div>
            ) : (
              <p className="empty-note profile-empty-note">还没有收藏歌曲。播放栏点亮爱心后，歌曲会出现在这里。</p>
            )}
          </section>

          <section className="profile-groups">
            {profileGroups.map((group) => (
              <div className="profile-list-card" key={group.title}>
                <h2>{group.title}</h2>
                {group.items.map((item) => (
                  <button className="profile-list-row" key={item.label}>
                    <span className={`row-icon ${group.tone}`}><Icon name={item.icon} /></span>
                    <strong>{item.label}</strong>
                    <Icon name="chevron_right" />
                  </button>
                ))}
              </div>
            ))}
          </section>
        </div>

        <aside className="pro-card">
          <div className="pro-title">
            <div>
              <h2>Pro 会员</h2>
              <p>尊享极致音乐学习体验</p>
            </div>
            <Icon name="workspace_premium" filled />
          </div>
          <ul>
            <li><Icon name="check_circle" />解锁高保真音质</li>
            <li><Icon name="check_circle" />专属生词本导出</li>
            <li><Icon name="check_circle" />AI发音纠错</li>
          </ul>
          <button>续费会员</button>
        </aside>
      </div>
    </section>
  );
}

function MobileNav() {
  const { view, setView } = useMeloStore();
  return (
    <nav className="mobile-nav" aria-label="移动端导航">
      {navItems.map((item) => <button key={item.id} className={`${view === item.id ? "active" : ""} ${item.id === "player" ? "center" : ""}`} onClick={() => setView(item.id)}><Icon name={item.icon} filled={view === item.id || item.id === "player"} />{item.id !== "player" && <small>{item.label}</small>}</button>)}
    </nav>
  );
}

function App() {
  const view = useMeloStore((state) => state.view);
  const uploadedSong = useMeloStore((state) => state.uploadedSong);
  const loadCurrentUser = useMeloStore((state) => state.loadCurrentUser);
  const loadProfile = useMeloStore((state) => state.loadProfile);
  const loadSavedWords = useMeloStore((state) => state.loadSavedWords);
  const loadLocalSongs = useMeloStore((state) => state.loadLocalSongs);
  const loadFavoriteSongs = useMeloStore((state) => state.loadFavoriteSongs);

  useEffect(() => {
    const loadAccountData = async () => {
      await loadCurrentUser();
      await Promise.all([
        loadProfile(),
        loadSavedWords(),
        loadLocalSongs(),
        loadFavoriteSongs(),
      ]);
    };

    loadAccountData();
  }, [loadCurrentUser, loadFavoriteSongs, loadLocalSongs, loadProfile, loadSavedWords]);

  const hasPlayerBar = view === "player" || Boolean(uploadedSong);

  return (
    <>
      <div className="atmosphere" aria-hidden="true" />
      <Header />
      <main className={hasPlayerBar ? "with-player-bar" : undefined}>
        {view === "library" && <LibraryView />}
        {view === "discover" && <DiscoverView />}
        {(view === "player" || uploadedSong) && <PlayerView showLyrics={view === "player"} />}
        {view === "progress" && <ProgressView />}
        {view === "profile" && <ProfileView />}
      </main>
      <MobileNav />
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
