import { create } from "zustand";
import type { ViewId } from "./data";

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
  sourceType?: "upload" | "youtube";
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
};

type PlaybackMode = "order" | "repeat-all" | "repeat-one";

const AUTH_TOKEN_KEY = "melomemo.authToken";
const AUTH_EXPIRES_AT_KEY = "melomemo.authExpiresAt";
const LEGACY_CURRENT_USER_KEY = "melomemo.currentUserId";
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
};

const clearAuthSession = () => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(AUTH_TOKEN_KEY);
  window.localStorage.removeItem(AUTH_EXPIRES_AT_KEY);
  window.localStorage.removeItem(LEGACY_CURRENT_USER_KEY);
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

type MeloState = {
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
};

export const useMeloStore = create<MeloState>((set, get) => ({
  view: "library",
  isPlaying: true,
  isRecording: false,
  activeWord: null,
  currentUser: null,
  profileStats: null,
  uploadedSong: null,
  localSongs: [],
  playbackMode: "repeat-all",
  isShuffle: false,
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
  setPlaying: (isPlaying) => set({ isPlaying }),
  loadCurrentUser: async () => {
    const savedToken = readAuthToken();
    if (!savedToken) {
      set({ currentUser: null, authStatus: "idle" });
      return;
    }

    try {
      const response = await fetch("/api/auth/me", createRequestOptions(savedToken));
      if (!response.ok) {
        throw new Error("Failed to load current user");
      }
      const data = await response.json();
      writeAuthSession(data.session);
      set({ currentUser: data.user, authStatus: "ready", authError: null });
    } catch {
      clearAuthSession();
      set({ currentUser: null, authStatus: "idle" });
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

      writeAuthSession(data.session);
      set({ currentUser: data.user, authStatus: "ready", authError: null });
      await Promise.all([
        get().loadProfile(),
        get().loadSavedWords(),
        get().loadWordLookupStats(),
        get().loadLocalSongs(),
        get().loadFavoriteSongs(),
      ]);
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

      writeAuthSession(data.session);
      set({ currentUser: data.user, authStatus: "ready", authError: null });
      await Promise.all([
        get().loadProfile(),
        get().loadSavedWords(),
        get().loadWordLookupStats(),
        get().loadLocalSongs(),
        get().loadFavoriteSongs(),
      ]);
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

      writeAuthSession(data.session);
      set({ currentUser: data.user, authStatus: "ready", authError: null });
      await Promise.all([
        get().loadProfile(),
        get().loadSavedWords(),
        get().loadWordLookupStats(),
        get().loadLocalSongs(),
        get().loadFavoriteSongs(),
      ]);
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
    set({
      currentUser: null,
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
      set({ profileStats: null, profileStatus: "idle" });
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

    set((state) => ({
      favoriteSongs: isSaved
        ? state.favoriteSongs.filter((item) => item.favoriteId !== favoriteId)
        : [
            {
              ...song,
              favoriteId,
              savedAt: new Date().toISOString(),
            },
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
}));
