import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BarChart, Bar, PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from "recharts";
import { featuredSong, navItems, profileGroups, profileStats, radarData, songs, studyCurve } from "./data";
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
  const token = window.localStorage.getItem("melomemo.authToken");
  const expiresAt = window.localStorage.getItem("melomemo.authExpiresAt");
  if (!token || !expiresAt || Date.parse(expiresAt) <= Date.now()) {
    window.localStorage.removeItem("melomemo.authToken");
    window.localStorage.removeItem("melomemo.authExpiresAt");
    window.localStorage.removeItem("melomemo.currentUserId");
    return {};
  }

  return { Authorization: `Bearer ${token}` };
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

function getStudyDurationParts(totalSeconds = 0) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const totalMinutes = Math.round(safeSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return {
      value: String(hours),
      unit: "小时",
      detail: minutes > 0 ? `${minutes} 分钟` : "已完整记录",
    };
  }

  return {
    value: String(totalMinutes),
    unit: "分钟",
    detail: totalMinutes > 0 ? "今天的每一次播放都会累积" : "开始播放歌曲后自动记录",
  };
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

function clampPopoverPosition({ x, y, width = 320, height = 360, margin = 18 }) {
  return {
    x: Math.min(window.innerWidth - width - margin, Math.max(margin, x)),
    y: Math.min(window.innerHeight - height - margin, Math.max(margin, y)),
  };
}

function shouldIgnorePlaybackShortcut(target) {
  if (!target || !(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']"),
  );
}

const LONG_PRESS_MS = 550;
const SEARCH_HISTORY_KEY = "melomemo.youtubeSearchHistory";
const MAX_SEARCH_HISTORY = 10;
const YOUTUBE_IFRAME_API_SRC = "https://www.youtube.com/iframe_api";
const OPEN_LYRICS_SEARCH_EVENT = "melomemo:open-lyrics-search";

function loadYouTubeIframeApi() {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (window.__melomemoYouTubeApiPromise) {
    return window.__melomemoYouTubeApiPromise;
  }

  window.__melomemoYouTubeApiPromise = new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("YouTube IFrame API timed out."));
      window.__melomemoYouTubeApiPromise = null;
    }, 4500);
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeout);
      previousReady?.();
      resolve(window.YT);
    };

    if (!document.querySelector(`script[src="${YOUTUBE_IFRAME_API_SRC}"]`)) {
      const script = document.createElement("script");
      script.src = YOUTUBE_IFRAME_API_SRC;
      script.async = true;
      script.onerror = () => {
        window.clearTimeout(timeout);
        window.__melomemoYouTubeApiPromise = null;
        reject(new Error("YouTube IFrame API failed to load."));
      };
      document.body.appendChild(script);
    }
  });

  return window.__melomemoYouTubeApiPromise;
}

function readSearchHistory() {
  try {
    const history = JSON.parse(window.localStorage.getItem(SEARCH_HISTORY_KEY) || "[]");
    return Array.isArray(history) ? history.filter((item) => typeof item === "string").slice(0, MAX_SEARCH_HISTORY) : [];
  } catch {
    return [];
  }
}

function writeSearchHistory(history) {
  window.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_SEARCH_HISTORY)));
}

function getYouTubeVideoIdFromText(text) {
  const rawText = text?.trim();
  if (!rawText) {
    return "";
  }

  const match = rawText.match(/(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\/[^\s"'<>]+/i);
  if (!match) {
    return "";
  }

  try {
    const url = new URL(match[0].startsWith("http") ? match[0] : `https://${match[0]}`);
    const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "").replace(/^music\./, "");

    if (host === "youtu.be") {
      return url.pathname.split("/").filter(Boolean)[0]?.match(/^[a-zA-Z0-9_-]{6,32}$/)?.[0] ?? "";
    }

    if (host !== "youtube.com") {
      return "";
    }

    const searchVideoId = url.searchParams.get("v");
    if (searchVideoId?.match(/^[a-zA-Z0-9_-]{6,32}$/)) {
      return searchVideoId;
    }

    const pathParts = url.pathname.split("/").filter(Boolean);
    const videoId = ["shorts", "embed", "live"].includes(pathParts[0]) ? pathParts[1] : "";
    return videoId?.match(/^[a-zA-Z0-9_-]{6,32}$/)?.[0] ?? "";
  } catch {
    return "";
  }
}

function Icon({ name, filled = false }) {
  return <span className={`material-symbols-outlined ${filled ? "filled" : ""}`}>{name}</span>;
}

function ConfirmDialog({ dialog, onResolve }) {
  useEffect(() => {
    if (!dialog) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onResolve(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dialog, onResolve]);

  if (!dialog) {
    return null;
  }

  return (
    <div className="app-dialog-backdrop" role="presentation" onPointerDown={() => onResolve(false)}>
      <section className={`app-dialog ${dialog.tone || ""}`} role="dialog" aria-modal="true" aria-labelledby="app-dialog-title" onPointerDown={(event) => event.stopPropagation()}>
        <div className="app-dialog-icon">
          <Icon name={dialog.icon || "help"} filled />
        </div>
        <div className="app-dialog-copy">
          <h2 id="app-dialog-title">{dialog.title}</h2>
          {dialog.message && <p>{dialog.message}</p>}
        </div>
        <div className="app-dialog-actions">
          <button className="glass-btn" type="button" onClick={() => onResolve(false)}>
            {dialog.cancelText || "取消"}
          </button>
          <button className={`primary-btn ${dialog.tone === "danger" ? "danger" : ""}`} type="button" onClick={() => onResolve(true)} autoFocus>
            <Icon name={dialog.confirmIcon || "check"} />
            {dialog.confirmText || "确认"}
          </button>
        </div>
      </section>
    </div>
  );
}

function useConfirmDialog() {
  const [dialog, setDialog] = useState(null);
  const resolverRef = useRef(null);

  const resolveDialog = (confirmed) => {
    resolverRef.current?.(confirmed);
    resolverRef.current = null;
    setDialog(null);
  };

  const confirm = (options) =>
    new Promise((resolve) => {
      resolverRef.current?.(false);
      resolverRef.current = resolve;
      setDialog(options);
    });

  const dialogElement = <ConfirmDialog dialog={dialog} onResolve={resolveDialog} />;

  return { confirm, dialogElement };
}

function SongMetadataDialog({ request, onResolve }) {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");

  useEffect(() => {
    if (!request) {
      return;
    }

    setTitle("");
    setArtist("");
  }, [request]);

  if (!request) {
    return null;
  }

  const submitMetadata = (event) => {
    event.preventDefault();
    onResolve({
      title: title.trim(),
      artist: artist.trim(),
    });
  };

  return (
    <div className="app-dialog-backdrop metadata-dialog-backdrop" role="presentation" onPointerDown={() => onResolve(null)}>
      <form className="app-dialog metadata-dialog" role="dialog" aria-modal="true" aria-labelledby="metadata-dialog-title" onSubmit={submitMetadata} onPointerDown={(event) => event.stopPropagation()}>
        <div className="app-dialog-icon">
          <Icon name="edit_note" filled />
        </div>
        <div className="app-dialog-copy">
          <h2 id="metadata-dialog-title">补充歌曲信息</h2>
          <p>粘贴的视频链接无法稳定判断歌曲名和歌手。填写后会用于保存曲库，也会优先用于歌词搜索。</p>
        </div>
        <div className="metadata-fields">
          <label>
            歌曲名
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="不填则使用 YouTube 标题" autoFocus />
          </label>
          <label>
            歌手名
            <input value={artist} onChange={(event) => setArtist(event.target.value)} placeholder="不填则使用 YouTube 频道" />
          </label>
        </div>
        <div className="app-dialog-actions">
          <button className="glass-btn" type="button" onClick={() => onResolve(null)}>取消</button>
          <button className="glass-btn" type="button" onClick={() => onResolve({ title: "", artist: "" })}>跳过</button>
          <button className="primary-btn" type="submit">
            <Icon name="download" />
            开始下载
          </button>
        </div>
      </form>
    </div>
  );
}

function useSongMetadataDialog() {
  const [request, setRequest] = useState(null);
  const resolverRef = useRef(null);

  const resolveDialog = (metadata) => {
    resolverRef.current?.(metadata);
    resolverRef.current = null;
    setRequest(null);
  };

  const askSongMetadata = (options) =>
    new Promise((resolve) => {
      resolverRef.current?.(null);
      resolverRef.current = resolve;
      setRequest(options);
    });

  return {
    askSongMetadata,
    metadataDialogElement: <SongMetadataDialog request={request} onResolve={resolveDialog} />,
  };
}

function formatPreviewTime(seconds) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

function YouTubePreviewModal({ result, status, progress, onClose, onDownload }) {
  const playerHostRef = useRef(null);
  const playerRef = useRef(null);
  const [isReady, setReady] = useState(false);
  const [isPlaying, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [previewMode, setPreviewMode] = useState("api");
  const embedUrl = `https://www.youtube.com/embed/${encodeURIComponent(result.id)}?controls=1&rel=0&modestbranding=1&playsinline=1`;

  useEffect(() => {
    let disposed = false;

    setReady(false);
    setPlaying(false);
    setDuration(0);
    setCurrentTime(0);
    setPreviewMode("api");

    loadYouTubeIframeApi()
      .then((YT) => {
        if (disposed || !playerHostRef.current) {
          return;
        }

        playerRef.current = new YT.Player(playerHostRef.current, {
          videoId: result.id,
          playerVars: {
            autoplay: 0,
            controls: 0,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
          },
          events: {
            onReady: (event) => {
              if (disposed) {
                return;
              }
              setReady(true);
              setDuration(event.target.getDuration() || 0);
            },
            onStateChange: (event) => {
              if (!window.YT?.PlayerState) {
                return;
              }
              setPlaying(event.data === window.YT.PlayerState.PLAYING);
              setDuration(event.target.getDuration() || 0);
            }
          },
        });
      })
      .catch(() => {
        if (!disposed) {
          setPreviewMode("iframe");
        }
      });

    return () => {
      disposed = true;
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
  }, [result.id]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player?.getCurrentTime) {
        return;
      }

      setCurrentTime(player.getCurrentTime() || 0);
      setDuration(player.getDuration?.() || 0);
    }, 350);

    return () => window.clearInterval(timer);
  }, []);

  const togglePreview = () => {
    const player = playerRef.current;
    if (!player || previewMode !== "api") {
      return;
    }

    if (isPlaying) {
      player.pauseVideo?.();
    } else {
      player.playVideo?.();
    }
  };

  const seekPreview = (event) => {
    const nextTime = Number(event.target.value);
    setCurrentTime(nextTime);
    if (previewMode === "api") {
      playerRef.current?.seekTo?.(nextTime, true);
    }
  };

  return (
    <div className="youtube-preview-backdrop" role="presentation" onPointerDown={onClose}>
      <section className="youtube-preview-modal" role="dialog" aria-modal="true" aria-label="预览 YouTube 视频" onPointerDown={(event) => event.stopPropagation()}>
        <div className="youtube-preview-player">
          {previewMode === "iframe" ? (
            <iframe
              title={result.title}
              src={embedUrl}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          ) : (
            <div ref={playerHostRef} />
          )}
          {previewMode === "api" && !isReady && (
            <div className="youtube-preview-loading">
              <Icon name="hourglass_top" />
              <span>正在加载预览...</span>
            </div>
          )}
        </div>
        <div className="youtube-preview-body">
          <div className="youtube-preview-meta">
            <span>{result.sourceType === "youtube-paste" ? "检测到 YouTube 链接" : "YouTube 预览"}</span>
            <h2>{result.title}</h2>
            <p>{result.sourceType === "youtube-paste" ? "请先预览视频内容，确认后再下载到曲库。" : result.channelTitle}</p>
          </div>
          <div className="youtube-preview-controls">
            <button className="icon-btn" type="button" aria-label={isPlaying ? "暂停预览" : "播放预览"} onClick={togglePreview} disabled={!isReady}>
              <Icon name={isPlaying ? "pause" : "play_arrow"} filled />
            </button>
            <span>{formatPreviewTime(currentTime)}</span>
            <input
              type="range"
              min="0"
              max={Math.max(duration, 1)}
              step="0.1"
              value={Math.min(currentTime, Math.max(duration, 1))}
              onChange={seekPreview}
              disabled={!isReady || duration <= 0}
              aria-label="拖动预览进度"
            />
            <span>{formatPreviewTime(duration)}</span>
          </div>
          {previewMode === "iframe" && (
            <p className="youtube-preview-fallback">YouTube 预览接口加载较慢，已切换到内嵌播放器；请使用视频画面内的控件预览。</p>
          )}
          {status === "loading" && (
            <div className="youtube-download-progress" role="status" aria-live="polite">
              <div>
                <span>{progress?.label || "正在准备下载..."}</span>
                <strong>{Math.round(progress?.percent ?? 8)}%</strong>
              </div>
              <i>
                <b style={{ width: `${Math.min(100, Math.max(0, progress?.percent ?? 8))}%` }} />
              </i>
            </div>
          )}
          <div className="youtube-preview-actions">
            <button className="glass-btn" type="button" onClick={onClose} disabled={status === "loading"}>取消</button>
            <button className="primary-btn" type="button" onClick={() => onDownload(result)} disabled={status === "loading"}>
              <Icon name={status === "loading" ? "hourglass_top" : "download"} />
              {status === "loading" ? "正在下载..." : result.sourceType === "youtube-paste" ? "确认下载" : "下载到曲库"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function Header() {
  const { view, setView, uploadedSong, addLocalSongs, setUploadedSong, updateSongLyrics } = useMeloStore();
  const searchRef = useRef(null);
  const searchInputRef = useRef(null);
  const [isSearchOpen, setSearchOpen] = useState(false);
  const [searchMode, setSearchMode] = useState("song");
  const [searchQuery, setSearchQuery] = useState("");
  const [lyricTitle, setLyricTitle] = useState("");
  const [lyricArtist, setLyricArtist] = useState("");
  const [searchStatus, setSearchStatus] = useState("idle");
  const [searchMessage, setSearchMessage] = useState("");
  const [searchSource, setSearchSource] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [lyricResults, setLyricResults] = useState([]);
  const [searchHistory, setSearchHistory] = useState(() => readSearchHistory());
  const [downloadStatus, setDownloadStatus] = useState({});
  const [downloadProgress, setDownloadProgress] = useState({});
  const [previewResult, setPreviewResult] = useState(null);
  const { confirm, dialogElement } = useConfirmDialog();
  const { askSongMetadata, metadataDialogElement } = useSongMetadataDialog();

  useEffect(() => {
    if (!isSearchOpen) {
      return;
    }

    searchInputRef.current?.focus();

    const handlePointerDown = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setSearchOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setSearchOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSearchOpen]);

  useEffect(() => {
    if (searchMode !== "lyrics") {
      return;
    }

    setLyricTitle((current) => current || uploadedSong?.title || "");
    setLyricArtist((current) => current || uploadedSong?.artist || "");
    setSearchResults([]);
  }, [searchMode, uploadedSong?.artist, uploadedSong?.title]);

  useEffect(() => {
    const handleOpenLyricsSearch = (event) => {
      const { title = "", artist = "" } = event.detail ?? {};
      setSearchOpen(true);
      setSearchMode("lyrics");
      setLyricTitle(title);
      setLyricArtist(artist);
      setSearchStatus("idle");
      setSearchMessage("");
      setSearchSource("");
      setSearchResults([]);
      setLyricResults([]);
      window.requestAnimationFrame(() => searchInputRef.current?.focus());
    };

    window.addEventListener(OPEN_LYRICS_SEARCH_EVENT, handleOpenLyricsSearch);
    return () => window.removeEventListener(OPEN_LYRICS_SEARCH_EVENT, handleOpenLyricsSearch);
  }, []);

  const openSearch = () => {
    setSearchOpen(true);
  };

  const closeSearch = () => {
    setPreviewResult(null);
    setSearchOpen(false);
  };

  const rememberSearchQuery = (query) => {
    const nextHistory = [
      query,
      ...searchHistory.filter((item) => item.toLowerCase() !== query.toLowerCase()),
    ].slice(0, MAX_SEARCH_HISTORY);
    setSearchHistory(nextHistory);
    writeSearchHistory(nextHistory);
  };

  const clearSearchHistory = () => {
    setSearchHistory([]);
    writeSearchHistory([]);
  };

  const handleSongSearchResult = (result) => {
    if (result.sourceType === "local" && result.song) {
      addLocalSongs([result.song]);
      setUploadedSong(result.song);
      setDownloadStatus((state) => ({ ...state, [result.id]: "ready" }));
      setSearchStatus("ready");
      setSearchSource("local-library");
      setSearchMessage("已从本地曲库打开。");
      return;
    }

    setPreviewResult(result);
  };

  const searchLyrics = async () => {
    const title = lyricTitle.trim();
    const artist = lyricArtist.trim();

    if (!title || !artist) {
      setSearchStatus("error");
      setSearchMessage("请输入歌曲名和歌手名。");
      setLyricResults([]);
      return;
    }

    setSearchStatus("loading");
    setSearchMessage("");
    setSearchResults([]);

    try {
      const params = new URLSearchParams({
        title,
        artist,
      });

      if (uploadedSong?.audioUrl) {
        // Duration is optional for LRCLIB matching; the backend will ignore invalid values.
      }

      const response = await fetch(`/api/lyrics/search?${params.toString()}`);
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.message || "歌词搜索失败。");
      }

      setLyricResults(data?.results ?? []);
      setSearchStatus("ready");
      setSearchMessage(data?.results?.length ? "" : "没有找到匹配歌词。");
    } catch (error) {
      setLyricResults([]);
      setSearchStatus("error");
      setSearchMessage(error instanceof Error ? error.message : "歌词搜索失败。");
    }
  };

  const searchYouTube = async (eventOrQuery) => {
    eventOrQuery?.preventDefault?.();
    if (searchMode === "lyrics" && typeof eventOrQuery !== "string") {
      await searchLyrics();
      return;
    }

    const query = typeof eventOrQuery === "string" ? eventOrQuery.trim() : searchQuery.trim();

    if (!query) {
      setSearchStatus("error");
      setSearchMessage("先输入一首歌名。");
      setSearchSource("");
      setSearchResults([]);
      return;
    }

    setSearchStatus("loading");
    setSearchMessage("");
    setSearchSource("");
    setSearchQuery(query);
    setLyricResults([]);
    rememberSearchQuery(query);

    try {
      const response = await fetch(`/api/youtube/search?q=${encodeURIComponent(query)}`);
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.message || "YouTube 搜索失败。");
      }

      setSearchResults(data?.results ?? []);
      setSearchSource(data?.source ?? "");
      setSearchStatus("ready");
      if (data?.source === "local-library") {
        setSearchMessage("已在本地曲库找到，不再搜索 YouTube。");
      } else {
        setSearchMessage(data?.results?.length ? "" : "没有找到匹配的 YouTube 结果。");
      }
    } catch (error) {
      setSearchResults([]);
      setSearchSource("");
      setSearchStatus("error");
      setSearchMessage(error instanceof Error ? error.message : "YouTube 搜索失败。");
    }
  };

  const searchFromHistory = (query) => {
    setSearchMode("song");
    void searchYouTube(query);
  };

  const applyLyricCandidate = async (candidate) => {
    if (!uploadedSong?.id) {
      setSearchStatus("error");
      setSearchMessage("请先打开一首本地或下载歌曲，再替换歌词。");
      return;
    }

    const shouldReplace = await confirm({
      title: "替换当前歌词？",
      message: `将使用「${candidate.title} - ${candidate.artist}」的歌词覆盖当前歌曲歌词。这个操作会立即保存到曲库。`,
      icon: "lyrics",
      confirmIcon: "swap_horiz",
      confirmText: "替换歌词",
      cancelText: "先不替换",
    });
    if (!shouldReplace) {
      return;
    }

    setDownloadStatus((state) => ({ ...state, [`lyrics:${candidate.id}`]: "loading" }));
    setSearchMessage("正在替换当前歌曲歌词...");

    try {
      await updateSongLyrics(uploadedSong.id, candidate.lyrics);
      setDownloadStatus((state) => ({ ...state, [`lyrics:${candidate.id}`]: "ready" }));
      setSearchStatus("ready");
      setSearchMessage("已替换当前歌曲歌词。");
    } catch (error) {
      setDownloadStatus((state) => ({ ...state, [`lyrics:${candidate.id}`]: "error" }));
      setSearchStatus("error");
      setSearchMessage(error instanceof Error ? error.message : "歌词替换失败。");
    }
  };

  const downloadYouTubeSong = async (result) => {
    let downloadTarget = result;
    if (result.sourceType === "youtube-paste") {
      const metadata = await askSongMetadata({ videoId: result.id });
      if (!metadata) {
        return;
      }

      downloadTarget = {
        ...result,
        title: metadata.title || result.title,
        channelTitle: metadata.artist || result.channelTitle,
        manualTitle: metadata.title,
        manualArtist: metadata.artist,
      };
    }

    setDownloadStatus((state) => ({ ...state, [result.id]: "loading" }));
    setDownloadProgress((state) => ({
      ...state,
      [result.id]: {
        percent: 8,
        label: "正在连接 YouTube...",
      },
    }));
    setSearchMessage("正在下载并转换为 MP3，可能需要一点时间...");
    const startedAt = Date.now();
    const progressTimer = window.setInterval(() => {
      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      const nextPercent = Math.min(92, 8 + elapsedSeconds * 3.2);
      const label = nextPercent < 30
        ? "正在提取视频音频..."
        : nextPercent < 58
          ? "正在下载音频与封面..."
          : nextPercent < 78
            ? "正在转码为 MP3..."
            : "正在匹配歌词并写入曲库...";
      setDownloadProgress((state) => ({
        ...state,
        [result.id]: {
          percent: nextPercent,
          label,
        },
      }));
    }, 700);

    try {
      const response = await fetch("/api/youtube/download", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getCurrentUserHeaders(),
        },
        body: JSON.stringify({
          videoId: downloadTarget.id,
          title: downloadTarget.title,
          channelTitle: downloadTarget.channelTitle,
          thumbnailUrl: downloadTarget.thumbnailUrl,
        }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.message || "下载失败。");
      }

      addLocalSongs([data.song]);
      setUploadedSong(data.song);
      setDownloadStatus((state) => ({ ...state, [result.id]: "ready" }));
      setDownloadProgress((state) => ({
        ...state,
        [result.id]: {
          percent: 100,
          label: "已完成下载，正在打开歌曲...",
        },
      }));
      setPreviewResult(null);
      setSearchMessage(data.reused ? "这首歌已在曲库中，已为你打开。" : "已下载到曲库，并转换为 MP3。");
    } catch (error) {
      setDownloadStatus((state) => ({ ...state, [result.id]: "error" }));
      setDownloadProgress((state) => ({
        ...state,
        [result.id]: {
          percent: 100,
          label: "下载失败",
        },
      }));
      setSearchStatus("error");
      setSearchMessage(error instanceof Error ? error.message : "下载失败。");
    } finally {
      window.clearInterval(progressTimer);
    }
  };

  useEffect(() => {
    const handlePaste = (event) => {
      const pastedText = event.clipboardData?.getData("text/plain") || "";
      const videoId = getYouTubeVideoIdFromText(pastedText);

      if (!videoId) {
        return;
      }

      event.preventDefault();
      setSearchMode("song");
      setSearchQuery(pastedText.trim());
      setSearchSource("youtube-paste");
      setSearchStatus("ready");
      setSearchResults([]);
      setLyricResults([]);
      setSearchMessage("检测到 YouTube 视频链接，请在预览弹窗中确认是否下载。");
      setPreviewResult({
        id: videoId,
        title: "粘贴的 YouTube 视频",
        channelTitle: "YouTube",
        sourceType: "youtube-paste",
        url: `https://www.youtube.com/watch?v=${videoId}`,
      });
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

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
	        <div className={`search-dock ${isSearchOpen ? "open" : ""}`} ref={searchRef}>
	          <button className="icon-btn" type="button" aria-label="搜索" onClick={openSearch}><Icon name="search" /></button>
	          <div className="search-panel" aria-hidden={!isSearchOpen}>
	            <form className="search-form" onSubmit={searchYouTube}>
	              <select
	                className="search-mode-select"
	                value={searchMode}
	                aria-label="选择搜索模式"
	                onChange={(event) => {
	                  setSearchMode(event.target.value);
	                  setSearchStatus("idle");
	                  setSearchMessage("");
	                  setSearchSource("");
	                  setSearchResults([]);
	                  setLyricResults([]);
	                }}
	              >
	                <option value="song">搜歌曲</option>
	                <option value="lyrics">搜歌词</option>
	              </select>
	              {searchMode === "song" ? (
	                <input
	                  ref={searchInputRef}
	                  type="search"
	                  value={searchQuery}
	                  onChange={(event) => setSearchQuery(event.target.value)}
	                  placeholder="输入歌曲名"
	                  aria-label="输入歌曲名搜索 YouTube"
	                />
	              ) : (
	                <div className="lyrics-search-fields">
	                  <input
	                    ref={searchInputRef}
	                    type="search"
	                    value={lyricTitle}
	                    onChange={(event) => setLyricTitle(event.target.value)}
	                    placeholder="歌曲名"
	                    aria-label="输入歌曲名搜索歌词"
	                  />
	                  <input
	                    type="search"
	                    value={lyricArtist}
	                    onChange={(event) => setLyricArtist(event.target.value)}
	                    placeholder="歌手名"
	                    aria-label="输入歌手名搜索歌词"
	                  />
	                </div>
	              )}
	              <button className="icon-btn tiny" type="submit" aria-label="提交搜索" disabled={searchStatus === "loading"}>
	                <Icon name={searchStatus === "loading" ? "hourglass_top" : "arrow_forward"} />
	              </button>
              <button className="icon-btn tiny ghost" type="button" aria-label="关闭搜索" onClick={closeSearch}>
                <Icon name="close" />
              </button>
            </form>
	            {(searchHistory.length > 0 || searchStatus !== "idle" || searchMessage || lyricResults.length > 0) && (
	              <div className="search-results">
	                {searchMode === "song" && searchHistory.length > 0 && (
	                  <section className="search-history" aria-label="搜索历史">
	                    <div className="search-history-head">
	                      <span>搜索记录</span>
	                    </div>
	                    <div className="search-history-list">
	                      {searchHistory.map((item) => (
	                        <button type="button" key={item} onClick={() => searchFromHistory(item)}>
	                          <Icon name="history" />
	                          <span>{item}</span>
	                        </button>
	                      ))}
	                    </div>
	                    <button className="clear-history-btn" type="button" onClick={clearSearchHistory}>
	                      清除所有搜索记录
	                    </button>
	                  </section>
	                )}
		                {searchStatus === "loading" && <p className="search-note">{searchMode === "lyrics" ? "正在搜索歌词..." : "正在搜索 YouTube..."}</p>}
	                {searchMessage && <p className={`search-note ${searchStatus === "error" ? "error" : ""}`}>{searchMessage}</p>}
	                {searchMode === "song" && searchResults.length > 0 && (
	                  <div className={`search-source ${searchSource === "local-library" ? "local" : "youtube"}`}>
	                    <Icon name={searchSource === "local-library" ? "folder_open" : "smart_display"} />
	                    <span>{searchSource === "local-library" ? "结果来源：本地曲库" : "结果来源：YouTube"}</span>
	                  </div>
	                )}
	                {searchMode === "lyrics" && lyricResults.map((result) => (
	                  <button className="lyric-search-result" type="button" key={result.id} onClick={() => applyLyricCandidate(result)} disabled={downloadStatus[`lyrics:${result.id}`] === "loading"}>
	                    <Icon name={result.lyricType === "synced" ? "lyrics" : "notes"} />
	                    <span>
	                      <strong>{result.title}</strong>
	                      <small>{result.artist}{result.album ? ` · ${result.album}` : ""} · {result.lyricType === "synced" ? "同步歌词" : "普通歌词"} · {result.lineCount} 行</small>
	                    </span>
	                    <Icon name={downloadStatus[`lyrics:${result.id}`] === "ready" ? "check_circle" : "library_music"} />
	                  </button>
	                ))}
	                {searchMode === "song" && searchResults.map((result) => (
	                  <button className="youtube-result" type="button" key={result.id} onClick={() => handleSongSearchResult(result)} disabled={downloadStatus[result.id] === "loading"}>
                    {result.thumbnailUrl ? <img src={result.thumbnailUrl} alt="" /> : <span className="youtube-thumb"><Icon name="music_note" /></span>}
                    <span>
                      <em className={`result-source-pill ${result.sourceType === "local" ? "local" : "youtube"}`}>
                        {result.sourceType === "local" ? "本地曲库" : "YouTube"}
                      </em>
                      <strong>{result.title}</strong>
                      <small>
                        {downloadStatus[result.id] === "loading"
                          ? "正在下载 MP3..."
                          : result.sourceType === "local"
                            ? `${result.channelTitle} · 本地曲库 · 点击播放`
                            : `${result.channelTitle} · 点击预览`}
                      </small>
                    </span>
                    <Icon name={downloadStatus[result.id] === "ready" ? "check_circle" : result.sourceType === "local" ? "folder_open" : "play_circle"} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <button className={`icon-btn ${view === "profile" ? "active-icon" : ""}`} aria-label="个人中心" onClick={() => setView("profile")}><Icon name="person" filled={view === "profile"} /></button>
      </div>
      {previewResult && (
        <YouTubePreviewModal
          result={previewResult}
          status={downloadStatus[previewResult.id]}
          progress={downloadProgress[previewResult.id]}
          onClose={() => setPreviewResult(null)}
          onDownload={downloadYouTubeSong}
        />
      )}
      {dialogElement}
      {metadataDialogElement}
    </header>
  );
}

function LibraryView() {
  const setView = useMeloStore((state) => state.setView);
  const setUploadedSong = useMeloStore((state) => state.setUploadedSong);
  const addLocalSongs = useMeloStore((state) => state.addLocalSongs);
  const deleteLocalSong = useMeloStore((state) => state.deleteLocalSong);
  const localSongs = useMeloStore((state) => state.localSongs);
  const songsStatus = useMeloStore((state) => state.songsStatus);
  const [uploadMessage, setUploadMessage] = useState("");
  const { confirm, dialogElement } = useConfirmDialog();
  const downloadedSongs = localSongs.filter((song) => song.sourceType === "youtube");
  const uploadedSongs = localSongs.filter((song) => song.sourceType !== "youtube");

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

  const handleDeleteSong = async (song) => {
    const shouldDelete = await confirm({
      title: "删除这首歌？",
      message: `「${song.title}」会从曲库移除，并同步删除数据库记录、本地音频、封面和歌词文件。`,
      icon: "delete",
      confirmIcon: "delete",
      confirmText: "删除歌曲",
      cancelText: "保留",
      tone: "danger",
    });
    if (!shouldDelete) {
      return;
    }

    try {
      await deleteLocalSong(song);
      setUploadMessage(`已删除「${song.title}」。`);
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : "删除歌曲失败。");
    }
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

      {downloadedSongs.length > 0 && (
        <>
          <SectionHead title="下载的音乐" subtitle="从 YouTube 搜索结果保存并转换为 MP3 的歌曲" />
          <div className="song-grid">
            {downloadedSongs.map((song) => (
              <article className="song-card" key={`${song.artist}-${song.title}`}>
                <span className="song-source-badge">YouTube MP3</span>
                <img src={song.coverUrl || "https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=900&q=80"} alt={`${song.title} 封面`} />
                <button aria-label={`播放 ${song.title}`} onClick={() => setUploadedSong(song)}><Icon name="play_circle" filled /></button>
                <button className="song-delete-btn" type="button" aria-label={`删除 ${song.title}`} onClick={() => handleDeleteSong(song)}>
                  <Icon name="delete" />
                </button>
                <h3>{song.title}</h3>
                <p>{song.artist}</p>
              </article>
            ))}
          </div>
        </>
      )}
      {uploadedSongs.length > 0 && (
        <>
          <SectionHead title="上传的音乐" subtitle="从本地文件夹导入的歌曲会显示在这里" />
          <div className="song-grid">
            {uploadedSongs.map((song) => (
              <article className="song-card" key={`${song.artist}-${song.title}`}>
                <span className="song-source-badge local">Local Upload</span>
                <img src={song.coverUrl || "https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=900&q=80"} alt={`${song.title} 封面`} />
                <button aria-label={`播放 ${song.title}`} onClick={() => setUploadedSong(song)}><Icon name="play_circle" filled /></button>
                <button className="song-delete-btn" type="button" aria-label={`删除 ${song.title}`} onClick={() => handleDeleteSong(song)}>
                  <Icon name="delete" />
                </button>
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
      {dialogElement}
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

const playbackRateOptions = [
  { value: 0.5, label: "0.5x" },
  { value: 0.75, label: "0.75x" },
  { value: 1, label: "1.0x" },
  { value: 1.25, label: "1.25x" },
  { value: 1.5, label: "1.5x" },
];

function PlayerView({ showLyrics = true }) {
  const { activeWord, isPlaying, isRecording, currentUser, setPlaying, togglePlaying, toggleRecording, toggleWord, saveWord, savedWords, uploadedSong, localSongs, playbackMode, isShuffle, playNextSong, playPreviousSong, handleSongEnded, togglePlaybackMode, toggleShuffle, pendingSeekTime, consumePendingSeekTime, favoriteSongs, toggleFavoriteSong, recordStudyHeartbeat, loadWordLookupStats, updateSongLyrics, setView } = useMeloStore();
  const audioRef = useRef(null);
  const activeLyricRef = useRef(null);
  const syncedLyricsRef = useRef(null);
  const wordPopoverRef = useRef(null);
  const demoWordPopoverRef = useRef(null);
  const lyricEditorRef = useRef(null);
  const lyricLongPressTimerRef = useRef(null);
  const progressTrackRef = useRef(null);
  const volumeTrackRef = useRef(null);
  const dragStateRef = useRef(null);
  const isSeekingRef = useRef(false);
  const isVolumeDraggingRef = useRef(false);
  const ttsAudioRef = useRef(null);
  const singerAudioRef = useRef(null);
  const singerStopTimerRef = useRef(null);
  const studyLastTickRef = useRef(Date.now());
  const studyPendingSecondsRef = useRef(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(225);
  const [volume, setVolume] = useState(0.7);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isRateMenuOpen, setRateMenuOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [recordPosition, setRecordPosition] = useState(null);
  const [wordPopover, setWordPopover] = useState(null);
  const [lyricEditor, setLyricEditor] = useState(null);
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
      title: uploadedSong?.title || "未选择歌曲",
      artist: uploadedSong?.artist || "从曲库选择或搜索歌曲",
      audioUrl: uploadedSong?.audioUrl,
      coverUrl: uploadedSong?.coverUrl,
      lyrics: uploadedSong ? uploadedSong.lyrics ?? [] : [],
    }),
    [uploadedSong],
  );
  const currentSongFavoriteId = currentSong.id
    ? `id:${currentSong.id}`
    : `song:${currentSong.title.trim().toLowerCase()}::${currentSong.artist.trim().toLowerCase()}`;
  const isCurrentSongFavorite = Boolean(uploadedSong) && favoriteSongs.some((song) => song.favoriteId === currentSongFavoriteId);
  const currentRateLabel = playbackRateOptions.find((option) => option.value === playbackRate)?.label || "1.0x";
  const currentPlaylistIndex = uploadedSong
    ? localSongs.findIndex((song) => (song.id && uploadedSong.id ? song.id === uploadedSong.id : song.title === uploadedSong.title && song.artist === uploadedSong.artist))
    : -1;
  const playlistLabel = localSongs.length > 0 && currentPlaylistIndex >= 0
    ? `${currentPlaylistIndex + 1}/${localSongs.length}`
    : localSongs.length > 0
      ? `${localSongs.length} 首`
      : "播放列表为空";
  const playbackModeMeta = playbackMode === "repeat-one"
    ? { icon: "repeat_one", label: "单曲循环" }
    : playbackMode === "repeat-all"
      ? { icon: "repeat", label: "列表循环" }
      : { icon: "arrow_right_alt", label: "顺序播放" };
  const canUseFullscreen = typeof document !== "undefined" && Boolean(document.fullscreenEnabled);
  const lyricLines = uploadedSong ? uploadedSong.lyrics ?? [] : [];
  const hasLyrics = lyricLines.length > 0;
  const getActiveLineIndex = (time) => lyricLines.reduce(
    (activeIndex, line, index) => (time >= line.time ? index : activeIndex),
    0,
  );
  const activeLineIndex = getActiveLineIndex(currentTime);
  const openLyricsSearch = () => {
    window.dispatchEvent(new CustomEvent(OPEN_LYRICS_SEARCH_EVENT, {
      detail: {
        title: uploadedSong?.title || "",
        artist: uploadedSong?.artist || "",
      },
    }));
  };
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

  const jumpToLyricLine = (line) => {
    const nextTime = Math.max(0, Number(line.time) || 0);

    setCurrentTime(nextTime);
    if (audioRef.current) {
      audioRef.current.currentTime = nextTime;
      if (audioRef.current.paused && isPlaying) {
        audioRef.current.play().catch(() => setPlaying(false));
      }
    }
    requestAnimationFrame(() => syncLyricsToTime(nextTime, "smooth"));
  };
  const jumpToLyricLineFromRow = (event, line) => {
    const target = event.target;
    if (target instanceof Element && target.closest(".lyric-word, .lyric-jump-zone, button")) {
      return;
    }

    jumpToLyricLine(line);
  };

  const openLyricEditor = (event, line, index) => {
    event.preventDefault();
    const anchor = event.currentTarget.getBoundingClientRect();
    const nextPosition = clampPopoverPosition({
      x: Math.min(anchor.left + anchor.width / 2 - 190, window.innerWidth - 398),
      y: anchor.top + anchor.height / 2 - 120,
      width: 380,
      height: 300,
    });

    setWordPopover(null);
    setLyricEditor({
      line,
      index,
      text: line.text,
      x: nextPosition.x,
      y: nextPosition.y,
      status: "idle",
      message: "",
    });
  };

  const clearLyricLongPress = () => {
    if (lyricLongPressTimerRef.current) {
      window.clearTimeout(lyricLongPressTimerRef.current);
      lyricLongPressTimerRef.current = null;
    }
  };

  const startLyricLongPress = (event, line, index) => {
    if (event.pointerType === "mouse") {
      return;
    }

    clearLyricLongPress();
    lyricLongPressTimerRef.current = window.setTimeout(() => {
      openLyricEditor(event, line, index);
    }, LONG_PRESS_MS);
  };

  const saveLyricEdit = async () => {
    if (!lyricEditor) {
      return;
    }

    const nextText = lyricEditor.text.trim();
    if (!nextText) {
      setLyricEditor((current) => current ? { ...current, status: "error", message: "歌词不能为空。" } : current);
      return;
    }

    const nextLyrics = lyricLines.map((line, index) =>
      index === lyricEditor.index ? { ...line, text: nextText } : line,
    );

    setLyricEditor((current) => current ? { ...current, status: "saving", message: "" } : current);

    if (!uploadedSong?.id) {
      setLyricEditor(null);
      return;
    }

    try {
      await updateSongLyrics(uploadedSong.id, nextLyrics);
      setLyricEditor(null);
    } catch (error) {
      setLyricEditor((current) =>
        current
          ? {
              ...current,
              status: "error",
              message: error instanceof Error ? error.message : "歌词保存失败。",
            }
          : current,
      );
    }
  };

  const startSeeking = (event) => {
    if (!uploadedSong?.audioUrl) {
      return;
    }

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

  const selectPlaybackRate = (nextRate) => {
    setPlaybackRate(nextRate);
    setRateMenuOpen(false);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
  };

  const toggleFullscreen = async (event) => {
    event?.currentTarget?.blur();

    if (!canUseFullscreen) {
      return;
    }

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
  };
  const openPlayerFromBar = (event) => {
    const target = event.target;
    const isControl = target instanceof Element && target.closest("button, input, select, textarea, [role='slider'], [role='menu'], [contenteditable='true']");
    if (isControl) {
      return;
    }

    setView(showLyrics ? "library" : "player");
  };
  const openPlayerFromBarKey = (event) => {
    if (event.code !== "Enter") {
      return;
    }

    event.preventDefault();
    setView(showLyrics ? "library" : "player");
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
    const initialPosition = clampPopoverPosition({
      x: rect.left + rect.width / 2 - 160,
      y: rect.bottom + 12,
      height: 420,
    });
    const sourceSong = uploadedSong?.title || "Ethereal Echoes";
    setWordPopover({
      word,
      x: initialPosition.x,
      y: initialPosition.y,
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
      const response = await fetch(`/api/dictionary/${encodeURIComponent(word)}`, {
        headers: getCurrentUserHeaders(),
      });
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
      void loadWordLookupStats();
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
    if (!wordPopover && !isEchoesOpen) {
      return;
    }

    const handlePointerDown = (event) => {
      const target = event.target;
      const isInsideWordPopover = wordPopoverRef.current?.contains(target);
      const isInsideDemoPopover = demoWordPopoverRef.current?.contains(target);
      const isLyricWord = target.closest?.(".lyric-word, .smart-word");

      if (wordPopover && !isInsideWordPopover && !isLyricWord) {
        setWordPopover(null);
      }

      if (isEchoesOpen && !isInsideDemoPopover && !isLyricWord) {
        toggleWord("echoes");
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isEchoesOpen, toggleWord, wordPopover]);

  useEffect(() => {
    if (!lyricEditor) {
      return;
    }

    const handlePointerDown = (event) => {
      if (lyricEditorRef.current?.contains(event.target)) {
        return;
      }

      setLyricEditor(null);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setLyricEditor(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [lyricEditor]);

  useEffect(() => clearLyricLongPress, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.code !== "Space" || event.repeat || shouldIgnorePlaybackShortcut(event.target) || !uploadedSong?.audioUrl) {
        return;
      }

      event.preventDefault();
      togglePlaying();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePlaying, uploadedSong?.audioUrl]);

  useLayoutEffect(() => {
    if (!wordPopover || !wordPopoverRef.current) {
      return;
    }

    const popover = wordPopoverRef.current;
    const rect = popover.getBoundingClientRect();
    const nextPosition = clampPopoverPosition({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });

    if (Math.abs(nextPosition.x - wordPopover.x) > 1 || Math.abs(nextPosition.y - wordPopover.y) > 1) {
      setWordPopover((current) =>
        current
          ? {
              ...current,
              x: nextPosition.x,
              y: nextPosition.y,
            }
          : current,
      );
    }
  }, [wordPopover]);

  useEffect(() => {
    if (!audioRef.current || !uploadedSong?.audioUrl) {
      return;
    }

    audioRef.current.volume = volume;
    audioRef.current.playbackRate = playbackRate;

    if (isPlaying) {
      audioRef.current.play().catch(() => setPlaying(false));
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying, playbackRate, setPlaying, uploadedSong?.audioUrl, volume]);

  useEffect(() => {
    setCurrentTime(0);
    setDuration(225);
    isSeekingRef.current = false;
  }, [uploadedSong?.audioUrl]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, uploadedSong?.audioUrl]);

  useEffect(() => {
    const songId = uploadedSong?.id;
    const songTitle = uploadedSong?.title;

    if (!uploadedSong?.audioUrl || !isPlaying) {
      studyLastTickRef.current = Date.now();
      return;
    }

    void recordStudyHeartbeat({ seconds: 0, songId, songTitle });
    studyLastTickRef.current = Date.now();

    const flushStudySeconds = () => {
      const seconds = Math.floor(studyPendingSecondsRef.current);
      if (seconds <= 0) {
        return;
      }

      studyPendingSecondsRef.current -= seconds;
      void recordStudyHeartbeat({ seconds, songId, songTitle });
    };

    const timer = window.setInterval(() => {
      const now = Date.now();
      const elapsedSeconds = Math.max(0, (now - studyLastTickRef.current) / 1000);
      const audio = audioRef.current;
      studyLastTickRef.current = now;

      if (!audio || audio.paused || audio.ended || document.hidden) {
        return;
      }

      studyPendingSecondsRef.current += elapsedSeconds;

      if (studyPendingSecondsRef.current >= 10) {
        flushStudySeconds();
      }
    }, 5000);

    return () => {
      window.clearInterval(timer);
      flushStudySeconds();
    };
  }, [isPlaying, recordStudyHeartbeat, uploadedSong?.audioUrl, uploadedSong?.id, uploadedSong?.title]);

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
    if (typeof document === "undefined") {
      return undefined;
    }

    const syncFullscreenState = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    syncFullscreenState();
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
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
  const displayTime = uploadedSong ? currentTime : 0;
  const displayDuration = uploadedSong ? duration : 0;
  const displayProgress = displayDuration > 0 ? Math.min(100, (displayTime / displayDuration) * 100) : 0;

  return (
    <>
      {uploadedSong?.audioUrl && (
        <audio
          ref={audioRef}
          src={uploadedSong.audioUrl}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => {
            event.currentTarget.playbackRate = playbackRate;
            setDuration(event.currentTarget.duration || 225);
          }}
          onEnded={(event) => {
            const result = handleSongEnded();
            if (result === "repeat-one" && event.currentTarget) {
              event.currentTarget.currentTime = 0;
              void event.currentTarget.play();
            }
          }}
        />
      )}
      {showLyrics && (
      <section className="view player-view">
        <div className={`lyric-stage ${uploadedSong ? "synced" : ""}`}>
          {uploadedSong ? (
            hasLyrics ? (
              <div className="synced-lyrics" ref={syncedLyricsRef}>
                {lyricLines.map((line, index) => (
                  <p
                    key={line.id}
	                    ref={index === activeLineIndex ? activeLyricRef : null}
	                    data-lyric-index={index}
	                    style={{ "--lyric-distance": Math.min(4, Math.abs(index - activeLineIndex)) }}
	                    className={`synced-line ${index === activeLineIndex ? "active" : ""}`}
	                    onContextMenu={(event) => openLyricEditor(event, line, index)}
	                    onPointerDown={(event) => startLyricLongPress(event, line, index)}
	                    onPointerMove={clearLyricLongPress}
	                    onPointerUp={clearLyricLongPress}
	                    onPointerCancel={clearLyricLongPress}
	                    onClick={(event) => jumpToLyricLineFromRow(event, line)}
	                  >
	                    <button
	                      className="lyric-jump-zone"
	                      type="button"
	                      aria-label={`跳转到 ${formatTime(line.time)}`}
	                      onClick={() => jumpToLyricLine(line)}
	                    >
	                      <Icon name="play_arrow" filled />
	                    </button>
	                    {renderClickableLyric(line.text, line)}
	                  </p>
                ))}
              </div>
            ) : (
              <div className="empty-lyrics-state">
                <button type="button" onClick={openLyricsSearch}>
                  <Icon name="lyrics" />
                  <strong>没有歌词</strong>
                  <span>点击搜索这首歌的歌词</span>
                </button>
              </div>
            )
          ) : null}
        </div>
      </section>
      )}
	      {showLyrics && wordPopover && (
	        <aside className="click-word-popover" ref={wordPopoverRef} style={{ left: wordPopover.x, top: wordPopover.y }}>
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
	      {showLyrics && lyricEditor && (
	        <aside className="lyric-edit-popover" ref={lyricEditorRef} style={{ left: lyricEditor.x, top: lyricEditor.y }}>
	          <div className="lyric-edit-head">
	            <span>编辑歌词</span>
	            <button className="icon-btn tiny ghost" type="button" aria-label="关闭歌词编辑" onClick={() => setLyricEditor(null)}>
	              <Icon name="close" />
	            </button>
	          </div>
	          <label>
	            <span>{formatTime(lyricEditor.line.time)}</span>
	            <textarea
	              value={lyricEditor.text}
	              rows={4}
	              autoFocus
	              onChange={(event) => setLyricEditor((current) => current ? { ...current, text: event.target.value, status: "idle", message: "" } : current)}
	              onKeyDown={(event) => {
	                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
	                  void saveLyricEdit();
	                }
	              }}
	            />
	          </label>
	          {lyricEditor.message && <p className="lyric-edit-message">{lyricEditor.message}</p>}
	          <div className="lyric-edit-actions">
	            <button className="mini-btn" type="button" onClick={() => setLyricEditor(null)}>取消</button>
	            <button className="primary-btn small" type="button" onClick={saveLyricEdit} disabled={lyricEditor.status === "saving"}>
	              {lyricEditor.status === "saving" ? "保存中..." : "保存修改"}
	            </button>
	          </div>
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
        <div className="control-glass player-jump-zone" onClick={openPlayerFromBar} onKeyDown={openPlayerFromBarKey} role="button" tabIndex="0" aria-label={showLyrics ? "返回曲库页面" : "打开歌词掌握页面"}>
          <div className="progress-row">
            <span>{formatTime(displayTime)}</span>
            <div className={`track seekable ${uploadedSong ? "" : "disabled"}`} ref={progressTrackRef} onPointerDown={startSeeking} role="slider" aria-valuemin="0" aria-valuemax={Math.round(displayDuration)} aria-valuenow={Math.round(displayTime)} tabIndex="0">
              <i style={{ width: `${displayProgress}%` }} />
              <b style={{ left: `${displayProgress}%` }} />
            </div>
            <span>{formatTime(displayDuration)}</span>
          </div>
          <div className="now-playing">
            {currentSong.coverUrl ? <img src={currentSong.coverUrl} alt="当前歌曲封面" /> : <span className="now-playing-placeholder"><Icon name="music_note" /></span>}
            <div><strong>{currentSong.title}</strong><span>{currentSong.artist} · {playlistLabel}</span></div>
          </div>
          <div className="transport">
            <button className={`icon-btn ghost ${isShuffle ? "active-icon" : ""}`} type="button" aria-label={isShuffle ? "关闭随机播放" : "开启随机播放"} aria-pressed={isShuffle} onClick={toggleShuffle} disabled={localSongs.length <= 1}><Icon name="shuffle" /></button>
            <button className="icon-btn ghost" type="button" aria-label="上一首" onClick={playPreviousSong} disabled={localSongs.length === 0}><Icon name="skip_previous" /></button>
            <button className="play-btn" aria-label={isPlaying ? "暂停" : "播放"} onClick={togglePlaying} disabled={!uploadedSong?.audioUrl}><Icon name={isPlaying ? "pause" : "play_arrow"} filled /></button>
            <button className="icon-btn ghost" type="button" aria-label="下一首" onClick={playNextSong} disabled={localSongs.length === 0}><Icon name="skip_next" /></button>
            <button className={`icon-btn ghost ${playbackMode !== "order" ? "active-icon" : ""}`} type="button" aria-label={playbackModeMeta.label} title={playbackModeMeta.label} onClick={togglePlaybackMode}><Icon name={playbackModeMeta.icon} /></button>
          </div>
          <div className="volume">
            <div className="rate-control">
              <button
                className="rate-btn"
                type="button"
                aria-label={`播放倍速，当前 ${currentRateLabel}`}
                aria-haspopup="menu"
                aria-expanded={isRateMenuOpen}
                onClick={() => setRateMenuOpen((isOpen) => !isOpen)}
              >
                <Icon name="speed" />
                <span>{currentRateLabel}</span>
              </button>
              {isRateMenuOpen && (
                <div className="rate-menu" role="menu" aria-label="选择播放倍速">
                  {playbackRateOptions.map((option) => (
                    <button
                      key={option.value}
                      className={option.value === playbackRate ? "active" : ""}
                      type="button"
                      role="menuitemradio"
                      aria-checked={option.value === playbackRate}
                      onClick={() => selectPlaybackRate(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              className={`icon-btn ghost fullscreen-btn ${isFullscreen ? "active-icon" : ""}`}
              type="button"
              aria-label={isFullscreen ? "退出全屏" : "进入全屏"}
              aria-pressed={isFullscreen}
              onClick={toggleFullscreen}
              title={isFullscreen ? "退出全屏" : "进入全屏"}
              disabled={!canUseFullscreen}
            >
              <Icon name={isFullscreen ? "fullscreen_exit" : "fullscreen"} />
            </button>
            <button
              className={`icon-btn ghost favorite-btn ${isCurrentSongFavorite ? "saved" : ""}`}
              type="button"
              aria-label={isCurrentSongFavorite ? "取消收藏当前歌曲" : "收藏当前歌曲"}
              aria-pressed={isCurrentSongFavorite}
              onClick={() => uploadedSong && toggleFavoriteSong(currentSong)}
              title={isCurrentSongFavorite ? "已收藏" : "收藏歌曲"}
              disabled={!uploadedSong}
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
  const { savedWords, vocabularyStatus, localSongs, openSongAtTime, profileStats: accountStats, wordLookupStats, wordLookupStatus } = useMeloStore();
  const [showAllLookupWords, setShowAllLookupWords] = useState(false);
  const studyDuration = getStudyDurationParts(accountStats?.totalStudySeconds ?? 0);
  const visibleLookupWords = showAllLookupWords ? wordLookupStats : wordLookupStats.slice(0, 4);

  return (
    <section className="view">
      <section className="overview-panel">
        <h1>词汇掌握概览</h1>
        <p>你已经通过 12 首歌曲掌握了以下语言成就。</p>
        <div className="stat-grid">
          <div><span>总掌握词汇</span><strong>{accountStats?.masteredWords ?? savedWords.length}</strong></div>
          <div><span>已攻克难句</span><strong>{accountStats?.conqueredSentences ?? 0}</strong></div>
          <div><span>学习时长</span><strong>{studyDuration.value}{studyDuration.unit}</strong></div>
          <div><span>发音准确度</span><strong>94%</strong></div>
        </div>
      </section>
      <div className="learning-grid">
        <section className="word-list">
          <div className="section-head compact">
            <h2>重点词汇卡片</h2>
            {wordLookupStats.length > 4 && (
              <button className="text-btn" type="button" onClick={() => setShowAllLookupWords((isOpen) => !isOpen)}>
                {showAllLookupWords ? "收起" : "查看全部"}
              </button>
            )}
          </div>
          {wordLookupStatus === "loading" && <p className="empty-note">正在读取查词热度...</p>}
          {wordLookupStatus === "error" && <p className="empty-note">暂时无法读取查词热度。</p>}
          {wordLookupStatus !== "loading" && wordLookupStats.length === 0 && (
            <p className="empty-note">还没有查词记录。去歌词掌握页点击单词后，这里会按查询次数展示重点词汇。</p>
          )}
          {visibleLookupWords.map((item) => (
            <article key={item.word}>
              <div>
                <h3>{item.word}</h3>
                <p>{item.phonetic || item.usPhonetic || "暂无音标"} · {item.meaning}</p>
              </div>
              <span className="lookup-count">{item.lookupCount} 次</span>
            </article>
          ))}
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
  const { profileStats: accountStats, profileStatus } = useMeloStore();
  const progressCurve = accountStats?.studyCurve?.length ? accountStats.studyCurve : studyCurve;
  const duration = getStudyDurationParts(accountStats?.totalStudySeconds ?? 0);
  const masteredWords = accountStats?.masteredWords ?? 0;
  const masteryPercent = Math.min(100, Math.round((masteredWords / 100) * 75));

  return (
    <section className="view">
      {profileStatus === "loading" && <p className="empty-note">正在同步学习数据...</p>}
      <div className="progress-top">
        <article className="metric-card"><Icon name="local_fire_department" filled /><p>连续学习</p><h2>{accountStats?.streakDays ?? 0} <small>天</small></h2><div className="mini-days">{(accountStats?.studyCurve ?? []).slice(-5).map((item) => <span className={item.studied ? "active" : ""} key={item.dateKey}>{item.day}</span>)}</div></article>
        <article className="metric-card primary"><p>累计时长</p><h2>{duration.value} <small>{duration.unit}</small></h2><span>{duration.detail} · 已学习 {accountStats?.cumulativeDays ?? 0} 天</span></article>
        <article className="metric-card ring-card"><p>掌握程度</p><div className="ring"><strong>{masteryPercent}%</strong></div><span>{masteredWords > 0 ? `已收藏 ${masteredWords} 个生词` : "收藏第一个生词后开始统计"}</span></article>
      </div>
      <div className="chart-grid">
        <section className="chart-card">
          <div className="section-head compact"><div><h2>学习曲线</h2><p>过去 30 天的旋律记忆波动</p></div><div className="segmented"><button>周</button><button>月</button></div></div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={progressCurve}><Bar dataKey="minutes" radius={[16, 16, 0, 0]} fill="url(#barGradient)" /><defs><linearGradient id="barGradient" x1="0" x2="0" y1="0" y2="1"><stop stopColor="var(--primary)" /><stop offset="1" stopColor="var(--secondary-soft)" /></linearGradient></defs></BarChart>
          </ResponsiveContainer>
          <div className="axis">{progressCurve.map((item) => <span key={item.dateKey || item.day}>{item.day}</span>)}</div>
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

function WechatQr({ sessionId, qrImageUrl }) {
  const blocks = useMemo(() => {
    const seed = sessionId || "melomemo-wechat";
    return Array.from({ length: 169 }, (_, index) => {
      const value = seed.charCodeAt(index % seed.length) + index * 17 + Math.floor(index / 13) * 23;
      const row = Math.floor(index / 13);
      const col = index % 13;
      const finder =
        (row < 4 && col < 4) ||
        (row < 4 && col > 8) ||
        (row > 8 && col < 4);
      return finder || value % 5 < 2;
    });
  }, [sessionId]);

  if (qrImageUrl) {
    return <img className="wechat-qr-image" src={qrImageUrl} alt="微信扫码登录二维码" />;
  }

  return (
    <div className="wechat-qr" aria-label="微信扫码登录二维码">
      {blocks.map((active, index) => <span key={index} className={active ? "active" : undefined} />)}
    </div>
  );
}

function ProfileLoginView() {
  const { authStatus, authError, loginWithEmail, registerWithEmail, startWechatLogin, checkWechatLogin } = useMeloStore();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ email: "", password: "", confirmPassword: "", displayName: "" });
  const [formError, setFormError] = useState("");
  const [wechatSession, setWechatSession] = useState(null);
  const [wechatMessage, setWechatMessage] = useState("点击刷新二维码后，用微信扫码登录");

  const updateField = (event) => {
    setFormError("");
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  const submitEmailAuth = async (event) => {
    event.preventDefault();
    setFormError("");

    if (mode === "login") {
      await loginWithEmail({ email: form.email, password: form.password });
      return;
    }

    if (form.password !== form.confirmPassword) {
      setFormError("两次输入的密码不一致。");
      return;
    }

    await registerWithEmail({
      email: form.email,
      password: form.password,
      displayName: form.displayName || "音律旅人",
    });
  };

  const refreshWechatQr = async () => {
    const session = await startWechatLogin();
    if (!session) {
      return;
    }

    setWechatSession(session);
    setWechatMessage("二维码已生成，等待微信确认");
  };

  useEffect(() => {
    if (!wechatSession?.sessionId) {
      return undefined;
    }

    const timer = window.setInterval(async () => {
      const loggedIn = await checkWechatLogin(wechatSession.sessionId);
      if (loggedIn) {
        setWechatMessage("微信登录成功，正在同步资料");
      }
    }, 1800);

    return () => window.clearInterval(timer);
  }, [checkWechatLogin, wechatSession]);

  return (
    <section className="view profile-view">
      <div className="login-panel">
        <section className="login-card">
          <div className="login-copy">
            <span className="login-kicker">MELOMEMO ACCOUNT</span>
            <h1>登录个人中心</h1>
            <p>同步收藏歌曲、生词本和学习曲线。微信扫码登录会直接进入你的音乐学习档案。</p>
          </div>

          <div className="wechat-login-box">
            <WechatQr sessionId={wechatSession?.sessionId} qrImageUrl={wechatSession?.qrImageUrl} />
            <div>
              <strong>微信扫码登录</strong>
              <span>{wechatMessage}</span>
            </div>
            <button className="text-btn" type="button" onClick={refreshWechatQr}>
              <Icon name="qr_code_scanner" />刷新二维码
            </button>
          </div>
        </section>

        <form className="email-login-card" onSubmit={submitEmailAuth}>
          <div className="auth-tabs">
            <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>登录</button>
            <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>注册</button>
          </div>
          {mode === "register" && (
            <label>
              昵称
              <input name="displayName" value={form.displayName} onChange={updateField} placeholder="音律旅人" />
            </label>
          )}
          <label>
            邮箱
            <input name="email" type="email" value={form.email} onChange={updateField} placeholder="you@example.com" required />
          </label>
          <label>
            密码
            <input name="password" type="password" value={form.password} onChange={updateField} placeholder="至少 6 位" minLength={6} required />
          </label>
          {mode === "register" && (
            <label>
              确认密码
              <input name="confirmPassword" type="password" value={form.confirmPassword} onChange={updateField} placeholder="再次输入密码" minLength={6} required />
            </label>
          )}
          {(formError || authError) && <p className="form-message">{formError || authError}</p>}
          <button className="primary-btn" type="submit" disabled={authStatus === "loading"}>
            <Icon name={mode === "login" ? "login" : "person_add"} />
            {authStatus === "loading" ? "处理中..." : mode === "login" ? "邮箱登录" : "创建账号"}
          </button>
        </form>
      </div>
    </section>
  );
}

function ProfileView() {
  const { currentUser, profileStats: accountStats, profileStatus, favoriteSongs, setUploadedSong, setView, logout } = useMeloStore();
  if (!currentUser) {
    return <ProfileLoginView />;
  }

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
            <button className="profile-logout" type="button" onClick={logout} aria-label="退出登录">
              <Icon name="logout" />
            </button>
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
  const loadWordLookupStats = useMeloStore((state) => state.loadWordLookupStats);
  const loadLocalSongs = useMeloStore((state) => state.loadLocalSongs);
  const loadFavoriteSongs = useMeloStore((state) => state.loadFavoriteSongs);

  useEffect(() => {
    const loadAccountData = async () => {
      await loadCurrentUser();
      if (!useMeloStore.getState().currentUser) {
        return;
      }
      await Promise.all([
        loadProfile(),
        loadSavedWords(),
        loadWordLookupStats(),
        loadLocalSongs(),
        loadFavoriteSongs(),
      ]);
    };

    loadAccountData();
  }, [loadCurrentUser, loadFavoriteSongs, loadLocalSongs, loadProfile, loadSavedWords, loadWordLookupStats]);

  useEffect(() => {
    const blurClickedButton = (event) => {
      const button = event.target instanceof Element ? event.target.closest("button") : null;
      button?.blur();
    };

    document.addEventListener("click", blurClickedButton);
    return () => document.removeEventListener("click", blurClickedButton);
  }, []);

  return (
    <>
      <div className="atmosphere" aria-hidden="true" />
      <Header />
      <main className="with-player-bar">
        {view === "library" && <LibraryView />}
        {view === "discover" && <DiscoverView />}
        <PlayerView showLyrics={view === "player"} />
        {view === "progress" && <ProgressView />}
        {view === "profile" && <ProfileView />}
      </main>
      <MobileNav />
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
