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
};

const CURRENT_USER_KEY = "melomemo.currentUserId";
const DEFAULT_USER = {
  email: "demo@melomemo.local",
  password: "melomemo-demo",
  displayName: "音律旅人",
};

const getSongFavoriteId = (song: Pick<FavoriteSong, "id" | "title" | "artist">) =>
  song.id ? `id:${song.id}` : `song:${song.title.trim().toLowerCase()}::${song.artist.trim().toLowerCase()}`;

const readCurrentUserId = () => {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(CURRENT_USER_KEY);
};

const writeCurrentUserId = (userId: string) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(CURRENT_USER_KEY, userId);
};

const createHeaders = (userId?: string | null) => ({
  "Content-Type": "application/json",
  ...(userId ? { "x-user-id": userId } : {}),
});

const createRequestOptions = (userId?: string | null) => ({
  headers: userId ? { "x-user-id": userId } : undefined,
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
  favoriteSongs: FavoriteSong[];
  savedWords: SavedWord[];
  pendingSeekTime: number | null;
  vocabularyStatus: "idle" | "loading" | "ready" | "error";
  songsStatus: "idle" | "loading" | "ready" | "error";
  profileStatus: "idle" | "loading" | "ready" | "error";
  setView: (view: ViewId) => void;
  setPlaying: (isPlaying: boolean) => void;
  loadCurrentUser: () => Promise<void>;
  loadProfile: () => Promise<void>;
  setUploadedSong: (song: UploadedSong) => void;
  openSongAtTime: (song: UploadedSong, time?: number) => void;
  consumePendingSeekTime: () => number | null;
  addLocalSongs: (songs: UploadedSong[]) => void;
  toggleFavoriteSong: (song: Omit<FavoriteSong, "favoriteId" | "savedAt">) => Promise<void>;
  isFavoriteSong: (song: Pick<FavoriteSong, "id" | "title" | "artist">) => boolean;
  loadFavoriteSongs: () => Promise<void>;
  loadLocalSongs: () => Promise<void>;
  togglePlaying: () => void;
  toggleRecording: () => void;
  toggleWord: (word: string) => void;
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
  favoriteSongs: [],
  savedWords: [],
  pendingSeekTime: null,
  vocabularyStatus: "idle",
  songsStatus: "idle",
  profileStatus: "idle",
  setView: (view) => set({ view, activeWord: null }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  loadCurrentUser: async () => {
    const savedUserId = readCurrentUserId();

    try {
      const response = await fetch("/api/auth/me", createRequestOptions(savedUserId));
      if (!response.ok) {
        throw new Error("Failed to load current user");
      }
      const data = await response.json();
      writeCurrentUserId(data.user.id);
      set({ currentUser: data.user });
    } catch {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: createHeaders(),
        body: JSON.stringify(DEFAULT_USER),
      });
      if (!response.ok) {
        set({ profileStatus: "error" });
        return;
      }
      const data = await response.json();
      writeCurrentUserId(data.user.id);
      set({ currentUser: data.user });
    }
  },
  loadProfile: async () => {
    const userId = get().currentUser?.id ?? readCurrentUserId();
    set({ profileStatus: "loading" });

    try {
      const response = await fetch("/api/profile", createRequestOptions(userId));
      if (!response.ok) {
        throw new Error("Failed to load profile");
      }
      const data = await response.json();
      writeCurrentUserId(data.user.id);
      set({
        currentUser: data.user,
        profileStats: data.stats,
        profileStatus: "ready",
      });
    } catch {
      set({ profileStatus: "error" });
    }
  },
  setUploadedSong: (song) => set({ uploadedSong: song, view: "player", isPlaying: true, pendingSeekTime: null }),
  openSongAtTime: (song, time) =>
    set({
      uploadedSong: song,
      view: "player",
      isPlaying: true,
      pendingSeekTime: typeof time === "number" ? time : null,
    }),
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
              (song) => song.title === existing.title && song.artist === existing.artist,
            ),
        ),
      ],
      uploadedSong: songs[0] ?? state.uploadedSong,
      view: songs.length > 0 ? "player" : state.view,
      isPlaying: songs.length > 0 ? true : state.isPlaying,
    })),
  toggleFavoriteSong: async (song) => {
    const userId = get().currentUser?.id ?? readCurrentUserId();
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
          ...createRequestOptions(userId),
        });
        if (!response.ok) {
          throw new Error("Failed to remove favorite");
        }
      } else {
        const response = await fetch("/api/favorites", {
          method: "POST",
          headers: createHeaders(userId),
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
    const userId = get().currentUser?.id ?? readCurrentUserId();

    try {
      const response = await fetch("/api/favorites", createRequestOptions(userId));
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
    const userId = get().currentUser?.id ?? readCurrentUserId();
    set({ songsStatus: "loading" });

    try {
      const response = await fetch("/api/songs", createRequestOptions(userId));
      if (!response.ok) {
        throw new Error("Failed to load songs");
      }
      const data = await response.json();
      set({ localSongs: data.songs, songsStatus: "ready" });
    } catch {
      set({ songsStatus: "error" });
    }
  },
  togglePlaying: () => set((state) => ({ isPlaying: !state.isPlaying })),
  toggleRecording: () => set((state) => ({ isRecording: !state.isRecording })),
  toggleWord: (word) =>
    set((state) => ({ activeWord: state.activeWord === word ? null : word })),
  loadSavedWords: async () => {
    const userId = get().currentUser?.id ?? readCurrentUserId();
    set({ vocabularyStatus: "loading" });

    try {
      const response = await fetch("/api/vocabulary", createRequestOptions(userId));
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
    const userId = get().currentUser?.id ?? readCurrentUserId();
    set((state) => ({
      savedWords: state.savedWords.some((item) => item.word === word.word)
        ? state.savedWords
        : [{ ...word, word: word.word.toLowerCase() }, ...state.savedWords],
    }));

    try {
      const response = await fetch("/api/vocabulary", {
        method: "POST",
        headers: createHeaders(userId),
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
