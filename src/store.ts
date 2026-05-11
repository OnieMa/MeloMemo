import { create } from "zustand";
import type { ViewId } from "./data";
import {
  buildLocalProfileStats,
  deleteLocalSong as deleteLocalSongRecord,
  listLocalFavorites,
  listLocalSongs as listLocalSongRecords,
  listLocalSongSyncRecords,
  listLocalStudyDays,
  listLocalVocabulary,
  listLocalWordLookups,
  recordLocalStudyHeartbeat,
  recordLocalWordLookup as recordLocalWordLookupEntry,
  removeLocalFavorite,
  saveLocalFavorite,
  saveLocalVocabularyWord,
  updateLocalSongLyrics,
} from "./localDb";

export type SavedWord = {
  id?: string;
  word: string;
  phonetic?: string;
  meaning: string;
  example?: string;
  sourceSong?: string;
  sourceSongId?: string;
  sourceTime?: number;
  sourceLine?: string;
  createdAt?: string;
  updatedAt?: string;
  savedAt?: string;
};

export type LyricLine = {
  id: string;
  time: number;
  text: string;
};

export type UploadedSong = {
  id?: string;
  title: string;
  artist: string;
  audioUrl: string;
  coverUrl?: string;
  lyrics: LyricLine[];
  lyricsUrl?: string;
  sourceType?: "upload" | "youtube" | "local-sync";
  sourceUrl?: string;
  externalId?: string;
};

export type FavoriteSong = {
  favoriteId: string;
  id?: string;
  title: string;
  artist: string;
  audioUrl?: string;
  coverUrl?: string;
  lyrics?: LyricLine[];
  savedAt: string;
};

export type MeloUser = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  bio: string;
  levelTitle: string;
};

export type UserProfileStats = {
  cumulativeDays: number;
  masteredWords: number;
  conqueredSentences: number;
  favoriteSongs: number;
  totalStudySeconds: number;
  totalStudyMinutes: number;
  streakDays: number;
  todayStudied: boolean;
  todaySeconds: number;
  studyCurve: Array<{
    dateKey: string;
    day: string;
    minutes: number;
    studied: boolean;
  }>;
};

export type WordLookupStat = {
  word: string;
  phonetic?: string;
  usPhonetic?: string;
  ukPhonetic?: string;
  partOfSpeech?: string;
  meaning: string;
  lookupCount: number;
  lastLookedUpAt: string;
  sourceSong?: string;
  sourceSongId?: string;
  sourceTime?: number;
  sourceLine?: string;
  sourceSongs?: Array<{
    songKey: string;
    songId?: string;
    songTitle: string;
    lookupCount: number;
    lastLookedUpAt: string;
    sourceTime?: number;
    sourceLine?: string;
  }>;
  songCount?: number;
};

export type LyricAnnotation = {
  id: string;
  songKey: string;
  lineId?: string;
  lineTime?: number;
  word: string;
  wordIndex: number;
  phonetic?: string;
  meaning: string;
  partOfSpeech?: string;
  sourceLine?: string;
  lastLookedUpAt: string;
};

type PlaybackMode = "order" | "repeat-all" | "repeat-one";
type AppMode = "local" | "cloud";
type PronunciationBackgroundMode = "duck" | "pause";

const AUTH_TOKEN_KEY = "melomemo.authToken";
const AUTH_EXPIRES_AT_KEY = "melomemo.authExpiresAt";
const LEGACY_CURRENT_USER_KEY = "melomemo.currentUserId";
const LOCAL_MODE_KEY = "melomemo.localModeEnabled";
const PRONUNCIATION_BACKGROUND_MODE_KEY = "melomemo.pronunciationBackgroundMode";
const LYRIC_ANNOTATIONS_ENABLED_KEY = "melomemo.lyricAnnotationsEnabled";
const LYRIC_ANNOTATIONS_KEY = "melomemo.lyricAnnotations";
const localUser: MeloUser = {
  id: "local",
  email: "local@melomemo.local",
  displayName: "本地模式",
  bio: "数据只保存在这台设备上",
  levelTitle: "LOCAL",
};

const getSongFavoriteId = (song: Pick<FavoriteSong, "id" | "title" | "artist">) =>
  song.id ? `id:${song.id}` : `song:${song.title.trim().toLowerCase()}::${song.artist.trim().toLowerCase()}`;

const getPlaylistSongKey = (song?: Pick<UploadedSong, "id" | "title" | "artist"> | null) =>
  song?.id ? `id:${song.id}` : song ? `song:${song.title.trim().toLowerCase()}::${song.artist.trim().toLowerCase()}` : "";

const getCurrentPlaylistIndex = (songs: UploadedSong[], currentSong?: UploadedSong | null) => {
  const currentKey = getPlaylistSongKey(currentSong);
  return currentKey ? songs.findIndex((song) => getPlaylistSongKey(song) === currentKey) : -1;
};

const getRandomPlaylistIndex = (length: number, currentIndex: number) => {
  if (length <= 1) {
    return 0;
  }

  let nextIndex = Math.floor(Math.random() * length);
  while (nextIndex === currentIndex) {
    nextIndex = Math.floor(Math.random() * length);
  }
  return nextIndex;
};

const readAuthToken = () => {
  if (typeof window === "undefined") {
    return null;
  }

  const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
  const expiresAt = window.localStorage.getItem(AUTH_EXPIRES_AT_KEY);
  if (!token || !expiresAt || Date.parse(expiresAt) <= Date.now()) {
    clearAuthSession();
    return null;
  }

  return token;
};

const writeAuthSession = (session?: { token?: string; expiresAt?: string }) => {
  if (typeof window === "undefined") {
    return;
  }

  if (!session?.token || !session.expiresAt) {
    return;
  }

  window.localStorage.setItem(AUTH_TOKEN_KEY, session.token);
  window.localStorage.setItem(AUTH_EXPIRES_AT_KEY, session.expiresAt);
  window.localStorage.removeItem(LEGACY_CURRENT_USER_KEY);
  window.localStorage.removeItem(LOCAL_MODE_KEY);
};

const clearAuthSession = () => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(AUTH_TOKEN_KEY);
  window.localStorage.removeItem(AUTH_EXPIRES_AT_KEY);
  window.localStorage.removeItem(LEGACY_CURRENT_USER_KEY);
};

const readLocalModePreference = () => {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(LOCAL_MODE_KEY) === "true";
};

const writeLocalModePreference = () => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(LOCAL_MODE_KEY, "true");
};

const clearLocalModePreference = () => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(LOCAL_MODE_KEY);
};

const readPronunciationBackgroundMode = (): PronunciationBackgroundMode => {
  if (typeof window === "undefined") {
    return "duck";
  }

  return window.localStorage.getItem(PRONUNCIATION_BACKGROUND_MODE_KEY) === "pause" ? "pause" : "duck";
};

const writePronunciationBackgroundMode = (mode: PronunciationBackgroundMode) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(PRONUNCIATION_BACKGROUND_MODE_KEY, mode);
};

const readLyricAnnotationsEnabled = () => {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(LYRIC_ANNOTATIONS_ENABLED_KEY) === "true";
};

const writeLyricAnnotationsEnabled = (enabled: boolean) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(LYRIC_ANNOTATIONS_ENABLED_KEY, String(enabled));
};

const readLyricAnnotations = (): LyricAnnotation[] => {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const annotations = JSON.parse(window.localStorage.getItem(LYRIC_ANNOTATIONS_KEY) || "[]");
    if (!Array.isArray(annotations)) {
      return [];
    }

    return annotations.filter((item): item is LyricAnnotation =>
      Boolean(
        item &&
          typeof item === "object" &&
          typeof item.id === "string" &&
          typeof item.songKey === "string" &&
          typeof item.word === "string" &&
          typeof item.wordIndex === "number" &&
          typeof item.meaning === "string" &&
          typeof item.lastLookedUpAt === "string",
      ),
    );
  } catch {
    return [];
  }
};

const writeLyricAnnotations = (annotations: LyricAnnotation[]) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(LYRIC_ANNOTATIONS_KEY, JSON.stringify(annotations.slice(0, 1000)));
};

const getLocalDateKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const createAuthHeader = (token = readAuthToken()): Record<string, string> =>
  token ? { Authorization: `Bearer ${token}` } : {};

const createHeaders = (token?: string | null): Record<string, string> => ({
  "Content-Type": "application/json",
  ...createAuthHeader(token),
});

const createRequestOptions = (token?: string | null): RequestInit => ({
  headers: createAuthHeader(token),
});

const getSafeFileName = (name: string, extension: string) => {
  const normalized = name.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ");
  return `${normalized || "melomemo-song"}${extension}`;
};

const ensureCloudSyncResponse = async (response: Response, fallbackMessage: string) => {
  if (response.ok) {
    return;
  }

  const data = await response.json().catch(() => null);
  throw new Error(data?.message || fallbackMessage);
};

const uploadLocalSongToCloud = async (
  song: Awaited<ReturnType<typeof listLocalSongSyncRecords>>[number],
  token: string,
) => {
  const formData = new FormData();
  const audioExtension = song.audioBlob.type.includes("mpeg") || song.audioBlob.type.includes("mp3") ? ".mp3" : ".audio";
  formData.append("title", song.title);
  formData.append("artist", song.artist);
  formData.append("lyrics", JSON.stringify(song.lyrics));
  formData.append("sourceType", "local-sync");
  formData.append("externalId", song.id);
  formData.append("audio", song.audioBlob, getSafeFileName(song.title, audioExtension));

  if (song.coverBlob) {
    formData.append("cover", song.coverBlob, getSafeFileName(`${song.title}-cover`, ".cover"));
  }

  const response = await fetch("/api/songs", {
    method: "POST",
    headers: createAuthHeader(token),
    body: formData,
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.message || "本地歌曲同步失败。");
  }

  return data.song as UploadedSong;
};

const syncLocalDataToCloud = async (token: string) => {
  const [localSongs, localFavorites, localWords, localLookups, localStudyDays] = await Promise.all([
    listLocalSongSyncRecords(),
    listLocalFavorites(),
    listLocalVocabulary(),
    listLocalWordLookups(),
    listLocalStudyDays(),
  ]);
  const cloudSongByLocalId = new Map<string, UploadedSong>();
  const cloudSongByTitle = new Map<string, UploadedSong>();
  const existingSongsResponse = await fetch("/api/songs", createRequestOptions(token));

  if (existingSongsResponse.ok) {
    const data = await existingSongsResponse.json().catch(() => null);
    for (const song of data?.songs ?? []) {
      if (song.sourceType === "local-sync" && song.externalId) {
        cloudSongByLocalId.set(song.externalId, song);
      }
      cloudSongByTitle.set(`${song.title.trim().toLowerCase()}::${song.artist.trim().toLowerCase()}`, song);
    }
  }

  for (const localSong of localSongs) {
    if (cloudSongByLocalId.has(localSong.id)) {
      continue;
    }

    const cloudSong = await uploadLocalSongToCloud(localSong, token);
    cloudSongByLocalId.set(localSong.id, cloudSong);
    cloudSongByTitle.set(`${localSong.title.trim().toLowerCase()}::${localSong.artist.trim().toLowerCase()}`, cloudSong);
  }

  const resolveCloudSong = (song?: Pick<FavoriteSong, "id" | "title" | "artist"> | null) => {
    if (!song) {
      return null;
    }

    return (song.id ? cloudSongByLocalId.get(song.id) : null)
      || cloudSongByTitle.get(`${song.title.trim().toLowerCase()}::${song.artist.trim().toLowerCase()}`)
      || null;
  };
  const mapSongId = (songId?: string) => songId ? cloudSongByLocalId.get(songId)?.id || songId : undefined;

  for (const word of localWords) {
    const response = await fetch("/api/vocabulary", {
      method: "POST",
      headers: createHeaders(token),
      body: JSON.stringify({
        ...word,
        sourceSongId: mapSongId(word.sourceSongId),
      }),
    });
    await ensureCloudSyncResponse(response, "本地生词同步失败。");
  }

  for (const favorite of localFavorites) {
    const cloudSong = resolveCloudSong(favorite);
    const response = await fetch("/api/favorites", {
      method: "POST",
      headers: createHeaders(token),
      body: JSON.stringify(cloudSong || favorite),
    });
    await ensureCloudSyncResponse(response, "本地收藏同步失败。");
  }

  if (localLookups.length > 0) {
    const response = await fetch("/api/word-lookups/sync", {
      method: "POST",
      headers: createHeaders(token),
      body: JSON.stringify({
        words: localLookups.map((lookup) => ({
          ...lookup,
          sourceSongs: lookup.sourceSongs?.map((song) => ({
            ...song,
            songId: mapSongId(song.songId),
            songKey: song.songId && cloudSongByLocalId.has(song.songId)
              ? `song-id:${cloudSongByLocalId.get(song.songId)?.id}`
              : song.songKey,
          })),
        })),
      }),
    });
    await ensureCloudSyncResponse(response, "本地查词记录同步失败。");
  }

  if (localStudyDays.length > 0) {
    const response = await fetch("/api/study/sync", {
      method: "POST",
      headers: createHeaders(token),
      body: JSON.stringify({
        days: localStudyDays.map((day) => ({
          ...day,
          learnedSongIds: day.learnedSongIds.map((songId) => mapSongId(songId) || songId),
        })),
      }),
    });
    await ensureCloudSyncResponse(response, "本地学习记录同步失败。");
  }
};

type MeloState = {
  appMode: AppMode;
  view: ViewId;
  isPlaying: boolean;
  isRecording: boolean;
  activeWord: string | null;
  currentUser: MeloUser | null;
  profileStats: UserProfileStats | null;
  uploadedSong: UploadedSong | null;
  localSongs: UploadedSong[];
  playbackMode: PlaybackMode;
  isShuffle: boolean;
  pronunciationBackgroundMode: PronunciationBackgroundMode;
  lyricAnnotationsEnabled: boolean;
  lyricAnnotations: LyricAnnotation[];
  favoriteSongs: FavoriteSong[];
  savedWords: SavedWord[];
  wordLookupStats: WordLookupStat[];
  pendingSeekTime: number | null;
  vocabularyStatus: "idle" | "loading" | "ready" | "error";
  wordLookupStatus: "idle" | "loading" | "ready" | "error";
  songsStatus: "idle" | "loading" | "ready" | "error";
  profileStatus: "idle" | "loading" | "ready" | "error";
  authStatus: "idle" | "loading" | "ready" | "error";
  authError: string | null;
  setView: (view: ViewId) => void;
  enterLocalMode: () => Promise<void>;
  showCloudLogin: () => void;
  setPlaying: (isPlaying: boolean) => void;
  loadCurrentUser: () => Promise<void>;
  loginWithEmail: (payload: { email: string; password: string }) => Promise<boolean>;
  registerWithEmail: (payload: { email: string; password: string; displayName?: string }) => Promise<boolean>;
  startWechatLogin: () => Promise<{ sessionId: string; expiresAt: string; qrImageUrl?: string } | null>;
  checkWechatLogin: (sessionId: string) => Promise<boolean>;
  logout: () => void;
  loadProfile: () => Promise<void>;
  setUploadedSong: (song: UploadedSong) => void;
  openSongAtTime: (song: UploadedSong, time?: number) => void;
  playNextSong: () => UploadedSong | null;
  playPreviousSong: () => UploadedSong | null;
  handleSongEnded: () => "repeat-one" | "next" | "stop";
  togglePlaybackMode: () => void;
  toggleShuffle: () => void;
  setPronunciationBackgroundMode: (mode: PronunciationBackgroundMode) => void;
  setLyricAnnotationsEnabled: (enabled: boolean) => void;
  recordLyricAnnotation: (annotation: Omit<LyricAnnotation, "id" | "lastLookedUpAt">) => void;
  consumePendingSeekTime: () => number | null;
  addLocalSongs: (songs: UploadedSong[]) => void;
  updateSongLyrics: (songId: string, lyrics: LyricLine[]) => Promise<UploadedSong | null>;
  deleteLocalSong: (song: UploadedSong) => Promise<void>;
  toggleFavoriteSong: (song: Omit<FavoriteSong, "favoriteId" | "savedAt">) => Promise<void>;
  isFavoriteSong: (song: Pick<FavoriteSong, "id" | "title" | "artist">) => boolean;
  loadFavoriteSongs: () => Promise<void>;
  loadLocalSongs: () => Promise<void>;
  recordStudyHeartbeat: (payload: { seconds?: number; songId?: string; songTitle?: string }) => Promise<void>;
  togglePlaying: () => void;
  toggleRecording: () => void;
  toggleWord: (word: string) => void;
  loadWordLookupStats: () => Promise<void>;
  loadSavedWords: () => Promise<void>;
  saveWord: (word: SavedWord) => Promise<void>;
  recordWordLookup: (entry: WordLookupStat) => Promise<void>;
};

export const useMeloStore = create<MeloState>((set, get) => ({
  appMode: "local",
  view: "profile",
  isPlaying: true,
  isRecording: false,
  activeWord: null,
  currentUser: null,
  profileStats: null,
  uploadedSong: null,
  localSongs: [],
  playbackMode: "repeat-all",
  isShuffle: false,
  pronunciationBackgroundMode: readPronunciationBackgroundMode(),
  lyricAnnotationsEnabled: readLyricAnnotationsEnabled(),
  lyricAnnotations: readLyricAnnotations(),
  favoriteSongs: [],
  savedWords: [],
  wordLookupStats: [],
  pendingSeekTime: null,
  vocabularyStatus: "idle",
  wordLookupStatus: "idle",
  songsStatus: "idle",
  profileStatus: "idle",
  authStatus: "idle",
  authError: null,
  setView: (view) => set({ view, activeWord: null }),
  enterLocalMode: async () => {
    clearAuthSession();
    writeLocalModePreference();
    set({
      appMode: "local",
      currentUser: localUser,
      authStatus: "idle",
      authError: null,
      view: "library",
    });
    await Promise.all([
      get().loadProfile(),
      get().loadSavedWords(),
      get().loadWordLookupStats(),
      get().loadLocalSongs(),
      get().loadFavoriteSongs(),
    ]);
  },
  showCloudLogin: () => {
    clearLocalModePreference();
    set({ currentUser: null, authStatus: "idle", authError: null, view: "profile" });
  },
  setPlaying: (isPlaying) => set({ isPlaying }),
  loadCurrentUser: async () => {
    const savedToken = readAuthToken();
    if (!savedToken) {
      set({
        appMode: "local",
        currentUser: readLocalModePreference() ? localUser : null,
        authStatus: "idle",
        view: "profile",
      });
      return;
    }

    try {
      const response = await fetch("/api/auth/me", createRequestOptions(savedToken));
      if (!response.ok) {
        throw new Error("Failed to load current user");
      }
      const data = await response.json();
      writeAuthSession(data.session);
      set({ appMode: "cloud", currentUser: data.user, authStatus: "ready", authError: null });
    } catch {
      clearAuthSession();
      set({
        appMode: "local",
        currentUser: readLocalModePreference() ? localUser : null,
        authStatus: "idle",
        view: "profile",
      });
    }
  },
  loginWithEmail: async (payload) => {
    set({ authStatus: "loading", authError: null });

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: createHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "登录失败，请稍后重试。");
      }

      const syncToken = data.session?.token;
      writeAuthSession(data.session);
      set({ appMode: "cloud", currentUser: data.user, authStatus: "ready", authError: null });
      const syncError = syncToken
        ? await syncLocalDataToCloud(syncToken).catch((error) => error)
        : null;
      await Promise.all([
        get().loadProfile(),
        get().loadSavedWords(),
        get().loadWordLookupStats(),
        get().loadLocalSongs(),
        get().loadFavoriteSongs(),
      ]);
      if (syncError) {
        set({ authError: syncError instanceof Error ? `登录成功，但本地数据同步失败：${syncError.message}` : "登录成功，但本地数据同步失败。" });
      }
      return true;
    } catch (error) {
      set({ authStatus: "error", authError: error instanceof Error ? error.message : "登录失败，请稍后重试。" });
      return false;
    }
  },
  registerWithEmail: async (payload) => {
    set({ authStatus: "loading", authError: null });

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: createHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "注册失败，请稍后重试。");
      }

      const syncToken = data.session?.token;
      writeAuthSession(data.session);
      set({ appMode: "cloud", currentUser: data.user, authStatus: "ready", authError: null });
      const syncError = syncToken
        ? await syncLocalDataToCloud(syncToken).catch((error) => error)
        : null;
      await Promise.all([
        get().loadProfile(),
        get().loadSavedWords(),
        get().loadWordLookupStats(),
        get().loadLocalSongs(),
        get().loadFavoriteSongs(),
      ]);
      if (syncError) {
        set({ authError: syncError instanceof Error ? `注册成功，但本地数据同步失败：${syncError.message}` : "注册成功，但本地数据同步失败。" });
      }
      return true;
    } catch (error) {
      set({ authStatus: "error", authError: error instanceof Error ? error.message : "注册失败，请稍后重试。" });
      return false;
    }
  },
  startWechatLogin: async () => {
    set({ authStatus: "loading", authError: null });

    try {
      const response = await fetch("/api/auth/wechat/qr", {
        method: "POST",
        headers: createHeaders(),
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "无法生成微信登录二维码。");
      }
      set({ authStatus: "idle", authError: null });
      return data;
    } catch (error) {
      set({ authStatus: "error", authError: error instanceof Error ? error.message : "无法生成微信登录二维码。" });
      return null;
    }
  },
  checkWechatLogin: async (sessionId) => {
    try {
      const response = await fetch(`/api/auth/wechat/check?sessionId=${encodeURIComponent(sessionId)}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "微信登录失败。");
      }
      if (data.status !== "confirmed" || !data.user) {
        return false;
      }

      const syncToken = data.session?.token;
      writeAuthSession(data.session);
      set({ appMode: "cloud", currentUser: data.user, authStatus: "ready", authError: null });
      const syncError = syncToken
        ? await syncLocalDataToCloud(syncToken).catch((error) => error)
        : null;
      await Promise.all([
        get().loadProfile(),
        get().loadSavedWords(),
        get().loadWordLookupStats(),
        get().loadLocalSongs(),
        get().loadFavoriteSongs(),
      ]);
      if (syncError) {
        set({ authError: syncError instanceof Error ? `登录成功，但本地数据同步失败：${syncError.message}` : "登录成功，但本地数据同步失败。" });
      }
      return true;
    } catch (error) {
      set({ authStatus: "error", authError: error instanceof Error ? error.message : "微信登录失败。" });
      return false;
    }
  },
  logout: () => {
    const token = readAuthToken();
    if (token) {
      void fetch("/api/auth/logout", {
        method: "POST",
        headers: createHeaders(token),
      }).catch(() => null);
    }
    clearAuthSession();
    clearLocalModePreference();
    set({
      appMode: "local",
      currentUser: null,
      view: "profile",
      profileStats: null,
      favoriteSongs: [],
      savedWords: [],
      wordLookupStats: [],
      localSongs: [],
      authStatus: "idle",
      authError: null,
    });
  },
  loadProfile: async () => {
    const token = readAuthToken();
    if (!token) {
      set({ profileStatus: "loading" });
      try {
        set({ profileStats: await buildLocalProfileStats(), profileStatus: "ready" });
      } catch {
        set({ profileStats: null, profileStatus: "error" });
      }
      return;
    }
    set({ profileStatus: "loading" });

    try {
      const response = await fetch("/api/profile", createRequestOptions(token));
      if (!response.ok) {
        throw new Error("Failed to load profile");
      }
      const data = await response.json();
      writeAuthSession(data.session);
      set({
        currentUser: data.user,
        profileStats: data.stats,
        profileStatus: "ready",
      });
    } catch {
      set({ profileStatus: "error" });
    }
  },
  setUploadedSong: (song) => set((state) => ({
    uploadedSong: song,
    localSongs: state.localSongs.some((item) => getPlaylistSongKey(item) === getPlaylistSongKey(song))
      ? state.localSongs
      : [song, ...state.localSongs],
    view: "player",
    isPlaying: true,
    pendingSeekTime: null,
  })),
  openSongAtTime: (song, time) =>
    set((state) => ({
      uploadedSong: song,
      localSongs: state.localSongs.some((item) => getPlaylistSongKey(item) === getPlaylistSongKey(song))
        ? state.localSongs
        : [song, ...state.localSongs],
      view: "player",
      isPlaying: true,
      pendingSeekTime: typeof time === "number" ? time : null,
    })),
  playNextSong: () => {
    const { localSongs, uploadedSong, isShuffle } = get();
    if (localSongs.length === 0) {
      return null;
    }

    const currentIndex = getCurrentPlaylistIndex(localSongs, uploadedSong);
    const nextIndex = isShuffle
      ? getRandomPlaylistIndex(localSongs.length, currentIndex)
      : currentIndex >= 0
        ? (currentIndex + 1) % localSongs.length
        : 0;
    const nextSong = localSongs[nextIndex] ?? null;
    if (nextSong) {
      set({ uploadedSong: nextSong, isPlaying: true, pendingSeekTime: null });
    }
    return nextSong;
  },
  playPreviousSong: () => {
    const { localSongs, uploadedSong, isShuffle } = get();
    if (localSongs.length === 0) {
      return null;
    }

    const currentIndex = getCurrentPlaylistIndex(localSongs, uploadedSong);
    const previousIndex = isShuffle
      ? getRandomPlaylistIndex(localSongs.length, currentIndex)
      : currentIndex >= 0
        ? (currentIndex - 1 + localSongs.length) % localSongs.length
        : localSongs.length - 1;
    const previousSong = localSongs[previousIndex] ?? null;
    if (previousSong) {
      set({ uploadedSong: previousSong, isPlaying: true, pendingSeekTime: null });
    }
    return previousSong;
  },
  handleSongEnded: () => {
    const { playbackMode, localSongs, uploadedSong, playNextSong } = get();
    if (playbackMode === "repeat-one") {
      set({ isPlaying: true, pendingSeekTime: 0 });
      return "repeat-one";
    }

    const currentIndex = getCurrentPlaylistIndex(localSongs, uploadedSong);
    const isLastSong = currentIndex >= 0 && currentIndex === localSongs.length - 1;
    if (playbackMode === "order" && isLastSong) {
      set({ isPlaying: false });
      return "stop";
    }

    const nextSong = playNextSong();
    if (!nextSong) {
      set({ isPlaying: false });
      return "stop";
    }
    return "next";
  },
  togglePlaybackMode: () =>
    set((state) => ({
      playbackMode:
        state.playbackMode === "repeat-all"
          ? "repeat-one"
          : state.playbackMode === "repeat-one"
            ? "order"
            : "repeat-all",
    })),
  toggleShuffle: () => set((state) => ({ isShuffle: !state.isShuffle })),
  setPronunciationBackgroundMode: (mode) => {
    writePronunciationBackgroundMode(mode);
    set({ pronunciationBackgroundMode: mode });
  },
  setLyricAnnotationsEnabled: (enabled) => {
    writeLyricAnnotationsEnabled(enabled);
    set({ lyricAnnotationsEnabled: enabled });
  },
  recordLyricAnnotation: (annotation) => {
    const now = new Date().toISOString();
    const word = annotation.word.trim().toLowerCase();
    const annotationId = [
      annotation.songKey,
      annotation.lineId || annotation.lineTime || "line",
      annotation.wordIndex,
      word,
    ].join("::");
    const nextAnnotation: LyricAnnotation = {
      ...annotation,
      id: annotationId,
      word,
      lastLookedUpAt: now,
    };
    const annotations = [
      nextAnnotation,
      ...get().lyricAnnotations.filter((item) => item.id !== annotationId),
    ];

    writeLyricAnnotations(annotations);
    set({ lyricAnnotations: annotations });
  },
  consumePendingSeekTime: () => {
    let seekTime: number | null = null;
    set((state) => {
      seekTime = state.pendingSeekTime;
      return { pendingSeekTime: null };
    });
    return seekTime;
  },
  addLocalSongs: (songs) =>
    set((state) => ({
      localSongs: [
        ...songs,
        ...state.localSongs.filter(
          (existing) =>
            !songs.some(
              (song) => getPlaylistSongKey(song) === getPlaylistSongKey(existing),
            ),
        ),
      ],
      uploadedSong: songs[0] ?? state.uploadedSong,
      view: songs.length > 0 ? "player" : state.view,
      isPlaying: songs.length > 0 ? true : state.isPlaying,
  })),
  updateSongLyrics: async (songId, lyrics) => {
    const token = readAuthToken();
    if (!token) {
      const updatedSong = await updateLocalSongLyrics(songId, lyrics);
      set((state) => ({
        uploadedSong: state.uploadedSong?.id === updatedSong.id ? updatedSong : state.uploadedSong,
        localSongs: state.localSongs.map((song) => (song.id === updatedSong.id ? updatedSong : song)),
        favoriteSongs: state.favoriteSongs.map((song) =>
          song.id === updatedSong.id ? { ...song, lyrics: updatedSong.lyrics } : song,
        ),
      }));
      return updatedSong;
    }

    const response = await fetch(`/api/songs/${encodeURIComponent(songId)}/lyrics`, {
      method: "PATCH",
      headers: createHeaders(token),
      body: JSON.stringify({ lyrics }),
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(data?.message || "歌词保存失败。");
    }

    const updatedSong = data.song as UploadedSong;
    set((state) => ({
      uploadedSong: state.uploadedSong?.id === updatedSong.id ? updatedSong : state.uploadedSong,
      localSongs: state.localSongs.map((song) => (song.id === updatedSong.id ? updatedSong : song)),
      favoriteSongs: state.favoriteSongs.map((song) =>
        song.id === updatedSong.id ? { ...song, lyrics: updatedSong.lyrics } : song,
      ),
    }));
    return updatedSong;
  },
  deleteLocalSong: async (song) => {
    if (!song.id) {
      return;
    }

    const token = readAuthToken();
    const favoriteId = getSongFavoriteId(song);
    const wasFavorite = get().favoriteSongs.some((item) => item.favoriteId === favoriteId || item.id === song.id);
    const previousState = {
      uploadedSong: get().uploadedSong,
      localSongs: get().localSongs,
      favoriteSongs: get().favoriteSongs,
      profileStats: get().profileStats,
    };

    set((state) => ({
      uploadedSong: state.uploadedSong?.id === song.id ? null : state.uploadedSong,
      localSongs: state.localSongs.filter((item) => item.id !== song.id),
      favoriteSongs: state.favoriteSongs.filter((item) => item.id !== song.id && item.favoriteId !== favoriteId),
      profileStats:
        wasFavorite && state.profileStats
          ? { ...state.profileStats, favoriteSongs: Math.max(0, state.profileStats.favoriteSongs - 1) }
          : state.profileStats,
    }));

    try {
      if (!token) {
        await deleteLocalSongRecord(song.id);
        await get().loadProfile();
        return;
      }

      const response = await fetch(`/api/songs/${encodeURIComponent(song.id)}`, {
        method: "DELETE",
        ...createRequestOptions(token),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.message || "删除歌曲失败。");
      }
    } catch (error) {
      set(previousState);
      throw error;
    }
  },
  toggleFavoriteSong: async (song) => {
    const token = readAuthToken();
    const favoriteId = getSongFavoriteId(song);
    const isSaved = get().favoriteSongs.some((item) => item.favoriteId === favoriteId);
    const nextFavorite = {
      ...song,
      favoriteId,
      savedAt: new Date().toISOString(),
    };

    set((state) => ({
      favoriteSongs: isSaved
        ? state.favoriteSongs.filter((item) => item.favoriteId !== favoriteId)
        : [
            nextFavorite,
            ...state.favoriteSongs,
          ],
      profileStats: state.profileStats
        ? {
            ...state.profileStats,
            favoriteSongs: Math.max(0, state.profileStats.favoriteSongs + (isSaved ? -1 : 1)),
          }
        : state.profileStats,
    }));

    try {
      if (!token) {
        if (isSaved) {
          await removeLocalFavorite(favoriteId);
        } else {
          await saveLocalFavorite(nextFavorite);
        }
        await get().loadProfile();
        return;
      }

      if (isSaved) {
        const response = await fetch(`/api/favorites/${encodeURIComponent(favoriteId)}`, {
          method: "DELETE",
          ...createRequestOptions(token),
        });
        if (!response.ok) {
          throw new Error("Failed to remove favorite");
        }
      } else {
        const response = await fetch("/api/favorites", {
          method: "POST",
          headers: createHeaders(token),
          body: JSON.stringify(song),
        });
        if (!response.ok) {
          throw new Error("Failed to save favorite");
        }
        const data = await response.json();
        set((state) => ({
          favoriteSongs: [
            data.song,
            ...state.favoriteSongs.filter((item) => item.favoriteId !== data.song.favoriteId),
          ],
        }));
      }

      await get().loadProfile();
    } catch {
      await get().loadFavoriteSongs();
      await get().loadProfile();
    }
  },
  isFavoriteSong: (song) => get().favoriteSongs.some((item) => item.favoriteId === getSongFavoriteId(song)),
  loadFavoriteSongs: async () => {
    const token = readAuthToken();
    if (!token) {
      set({ favoriteSongs: await listLocalFavorites() });
      return;
    }

    try {
      const response = await fetch("/api/favorites", createRequestOptions(token));
      if (!response.ok) {
        throw new Error("Failed to load favorites");
      }
      const data = await response.json();
      set({ favoriteSongs: data.songs });
    } catch {
      set({ favoriteSongs: [] });
    }
  },
  loadLocalSongs: async () => {
    const token = readAuthToken();
    set({ songsStatus: "loading" });
    if (!token) {
      try {
        set({ localSongs: await listLocalSongRecords(), songsStatus: "ready" });
      } catch {
        set({ songsStatus: "error" });
      }
      return;
    }

    try {
      const response = await fetch("/api/songs", createRequestOptions(token));
      if (!response.ok) {
        throw new Error("Failed to load songs");
      }
      const data = await response.json();
      set({ localSongs: data.songs, songsStatus: "ready" });
    } catch {
      set({ songsStatus: "error" });
    }
  },
  recordStudyHeartbeat: async ({ seconds = 0, songId, songTitle }) => {
    const token = readAuthToken();
    if (!token) {
      await recordLocalStudyHeartbeat({ seconds, songId });
      set({ profileStats: await buildLocalProfileStats() });
      return;
    }

    try {
      const response = await fetch("/api/study/heartbeat", {
        method: "POST",
        headers: createHeaders(token),
        body: JSON.stringify({
          seconds,
          songId,
          songTitle,
          dateKey: getLocalDateKey(),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to record study time");
      }

      const data = await response.json();
      set({ profileStats: data.stats });
    } catch {
      // Study tracking should never interrupt playback.
    }
  },
  togglePlaying: () => set((state) => ({ isPlaying: !state.isPlaying })),
  toggleRecording: () => set((state) => ({ isRecording: !state.isRecording })),
  toggleWord: (word) =>
    set((state) => ({ activeWord: state.activeWord === word ? null : word })),
  loadWordLookupStats: async () => {
    const token = readAuthToken();
    set({ wordLookupStatus: "loading" });
    if (!token) {
      try {
        set({ wordLookupStats: await listLocalWordLookups(), wordLookupStatus: "ready" });
      } catch {
        set({ wordLookupStatus: "error" });
      }
      return;
    }

    try {
      const response = await fetch("/api/word-lookups", createRequestOptions(token));
      if (!response.ok) {
        throw new Error("Failed to load word lookup stats");
      }
      const data = await response.json();
      set({ wordLookupStats: data.words, wordLookupStatus: "ready" });
    } catch {
      set({ wordLookupStatus: "error" });
    }
  },
  loadSavedWords: async () => {
    const token = readAuthToken();
    set({ vocabularyStatus: "loading" });
    if (!token) {
      try {
        set({ savedWords: await listLocalVocabulary(), vocabularyStatus: "ready" });
      } catch {
        set({ vocabularyStatus: "error" });
      }
      return;
    }

    try {
      const response = await fetch("/api/vocabulary", createRequestOptions(token));
      if (!response.ok) {
        throw new Error("Failed to load vocabulary");
      }
      const data = await response.json();
      set({ savedWords: data.words, vocabularyStatus: "ready" });
    } catch {
      set({ vocabularyStatus: "error" });
    }
  },
  saveWord: async (word) => {
    const token = readAuthToken();
    set((state) => ({
      savedWords: state.savedWords.some((item) => item.word === word.word)
        ? state.savedWords
        : [{ ...word, word: word.word.toLowerCase() }, ...state.savedWords],
    }));

    try {
      if (!token) {
        await saveLocalVocabularyWord(word);
        set({ vocabularyStatus: "ready", profileStats: await buildLocalProfileStats() });
        return;
      }

      const response = await fetch("/api/vocabulary", {
        method: "POST",
        headers: createHeaders(token),
        body: JSON.stringify(word),
      });
      if (!response.ok) {
        throw new Error("Failed to save vocabulary");
      }
      const data = await response.json();
      set((state) => ({
        savedWords: [
          data.word,
          ...state.savedWords.filter((item) => item.word !== data.word.word),
        ],
        vocabularyStatus: "ready",
      }));
      await get().loadProfile();
    } catch {
      set({ vocabularyStatus: "error" });
    }
  },
  recordWordLookup: async (entry) => {
    const token = readAuthToken();
    if (token) {
      return;
    }
    await recordLocalWordLookupEntry(entry);
    set({ wordLookupStats: await listLocalWordLookups() });
  },
}));
