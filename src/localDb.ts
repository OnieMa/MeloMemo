import type { FavoriteSong, LyricLine, SavedWord, UploadedSong, UserProfileStats, WordLookupStat } from "./store";

type LocalSongRecord = {
  id: string;
  title: string;
  artist: string;
  audioBlob: Blob;
  coverBlob?: Blob;
  lyrics: LyricLine[];
  sourceType: "upload";
  createdAt: string;
  updatedAt: string;
};

type LocalFavoriteRecord = FavoriteSong;

type LocalStudyDayRecord = {
  dateKey: string;
  totalSeconds: number;
  learnedSongIds: string[];
  lastStudiedAt: string;
};

type LocalWordLookupRecord = WordLookupStat;

export type LocalSongSyncRecord = LocalSongRecord;
export type LocalStudyDaySyncRecord = LocalStudyDayRecord;

const DB_NAME = "melomemo-local";
const DB_VERSION = 1;
const SONG_STORE = "songs";
const FAVORITE_STORE = "favoriteSongs";
const VOCABULARY_STORE = "vocabularyWords";
const STUDY_STORE = "studyDays";
const WORD_LOOKUP_STORE = "wordLookups";

const objectUrls = new Set<string>();

const createObjectUrl = (blob?: Blob) => {
  if (!blob) {
    return undefined;
  }
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  return url;
};

export const revokeLocalObjectUrls = () => {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls.clear();
};

const openLocalDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SONG_STORE)) {
        db.createObjectStore(SONG_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(FAVORITE_STORE)) {
        db.createObjectStore(FAVORITE_STORE, { keyPath: "favoriteId" });
      }
      if (!db.objectStoreNames.contains(VOCABULARY_STORE)) {
        db.createObjectStore(VOCABULARY_STORE, { keyPath: "word" });
      }
      if (!db.objectStoreNames.contains(STUDY_STORE)) {
        db.createObjectStore(STUDY_STORE, { keyPath: "dateKey" });
      }
      if (!db.objectStoreNames.contains(WORD_LOOKUP_STORE)) {
        db.createObjectStore(WORD_LOOKUP_STORE, { keyPath: "word" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open local database"));
  });

const requestToPromise = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });

const transactionDone = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });

const getAll = async <T>(storeName: string) => {
  const db = await openLocalDb();
  try {
    const transaction = db.transaction(storeName, "readonly");
    return await requestToPromise<T[]>(transaction.objectStore(storeName).getAll());
  } finally {
    db.close();
  }
};

const putRecord = async <T>(storeName: string, record: T) => {
  const db = await openLocalDb();
  try {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(record);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
};

const deleteRecord = async (storeName: string, key: IDBValidKey) => {
  const db = await openLocalDb();
  try {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(key);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
};

const localSongToUploadedSong = (song: LocalSongRecord): UploadedSong => ({
  id: song.id,
  title: song.title,
  artist: song.artist,
  audioUrl: createObjectUrl(song.audioBlob) ?? "",
  coverUrl: createObjectUrl(song.coverBlob),
  lyrics: song.lyrics,
  sourceType: song.sourceType,
});

const todayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const dayLabel = (dateKey: string) => {
  const date = new Date(`${dateKey}T00:00:00`);
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

const buildLocalStudyCurve = (studyDays: LocalStudyDayRecord[]) => {
  const byDate = new Map(studyDays.map((day) => [day.dateKey, day]));
  const curve: UserProfileStats["studyCurve"] = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - 29);

  for (let index = 0; index < 30; index += 1) {
    const dateKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    const record = byDate.get(dateKey);
    curve.push({
      dateKey,
      day: dayLabel(dateKey),
      minutes: Math.round((record?.totalSeconds ?? 0) / 60),
      studied: Boolean(record && record.totalSeconds > 0),
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return curve;
};

const countLocalStreak = (studyDays: LocalStudyDayRecord[]) => {
  const studied = new Set(studyDays.filter((day) => day.totalSeconds > 0).map((day) => day.dateKey));
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  let streak = 0;

  while (true) {
    const dateKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    if (!studied.has(dateKey)) {
      return streak;
    }
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
};

export const saveLocalSongDraft = async (song: {
  title: string;
  artist: string;
  audioFile: File;
  coverFile?: File;
  lyrics: LyricLine[];
}) => {
  const now = new Date().toISOString();
  const record: LocalSongRecord = {
    id: `local-${crypto.randomUUID()}`,
    title: song.title,
    artist: song.artist,
    audioBlob: song.audioFile,
    coverBlob: song.coverFile,
    lyrics: song.lyrics,
    sourceType: "upload",
    createdAt: now,
    updatedAt: now,
  };

  await putRecord(SONG_STORE, record);
  return localSongToUploadedSong(record);
};

export const listLocalSongs = async () => {
  const songs = await getAll<LocalSongRecord>(SONG_STORE);
  revokeLocalObjectUrls();
  return songs
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(localSongToUploadedSong);
};

export const listLocalSongSyncRecords = async () => {
  const songs = await getAll<LocalSongRecord>(SONG_STORE);
  return songs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

export const deleteLocalSong = async (songId: string) => {
  await deleteRecord(SONG_STORE, songId);
};

export const updateLocalSongLyrics = async (songId: string, lyrics: LyricLine[]) => {
  const db = await openLocalDb();
  try {
    const transaction = db.transaction(SONG_STORE, "readwrite");
    const store = transaction.objectStore(SONG_STORE);
    const record = await requestToPromise<LocalSongRecord | undefined>(store.get(songId));
    if (!record) {
      throw new Error("歌曲不存在。");
    }
    const updated = { ...record, lyrics, updatedAt: new Date().toISOString() };
    store.put(updated);
    await transactionDone(transaction);
    return localSongToUploadedSong(updated);
  } finally {
    db.close();
  }
};

export const listLocalFavorites = () => getAll<LocalFavoriteRecord>(FAVORITE_STORE);

export const saveLocalFavorite = (song: LocalFavoriteRecord) => putRecord(FAVORITE_STORE, song);

export const removeLocalFavorite = (favoriteId: string) => deleteRecord(FAVORITE_STORE, favoriteId);

export const listLocalVocabulary = async () => {
  const words = await getAll<SavedWord>(VOCABULARY_STORE);
  return words.sort((a, b) => (b.id ?? "").localeCompare(a.id ?? ""));
};

export const saveLocalVocabularyWord = (word: SavedWord) =>
  putRecord(VOCABULARY_STORE, {
    ...word,
    id: word.id ?? new Date().toISOString(),
    word: word.word.toLowerCase(),
  });

export const listLocalWordLookups = async () => {
  const words = await getAll<LocalWordLookupRecord>(WORD_LOOKUP_STORE);
  return words
    .map((item) => ({
      ...item,
      songCount: item.sourceSongs?.length ?? 0,
    }))
    .sort((a, b) => b.lookupCount - a.lookupCount || b.lastLookedUpAt.localeCompare(a.lastLookedUpAt));
};

export const listLocalStudyDays = () => getAll<LocalStudyDayRecord>(STUDY_STORE);

const getWordLookupSongRef = (entry: {
  sourceSong?: string;
  sourceSongId?: string;
  sourceTime?: number;
  sourceLine?: string;
}) => {
  const songTitle = entry.sourceSong?.trim();

  if (!songTitle && !entry.sourceSongId) {
    return null;
  }

  return {
    songKey: entry.sourceSongId ? `song-id:${entry.sourceSongId}` : `song-title:${songTitle}`,
    songId: entry.sourceSongId,
    songTitle: songTitle || "未命名歌曲",
    sourceTime: entry.sourceTime,
    sourceLine: entry.sourceLine,
  };
};

const mergeWordLookupSongRefs = (
  existing: WordLookupStat["sourceSongs"] = [],
  entry: {
    sourceSong?: string;
    sourceSongId?: string;
    sourceTime?: number;
    sourceLine?: string;
  },
  lookedUpAt: string,
) => {
  const nextRef = getWordLookupSongRef(entry);

  if (!nextRef) {
    return existing;
  }

  const refs = new Map((existing ?? []).map((item) => [item.songKey, item]));
  const previous = refs.get(nextRef.songKey);
  refs.set(nextRef.songKey, {
    ...previous,
    ...nextRef,
    lookupCount: (previous?.lookupCount ?? 0) + 1,
    lastLookedUpAt: lookedUpAt,
  });

  return [...refs.values()].sort((a, b) => b.lastLookedUpAt.localeCompare(a.lastLookedUpAt));
};

export const recordLocalWordLookup = async (entry: {
  word: string;
  phonetic?: string;
  usPhonetic?: string;
  ukPhonetic?: string;
  partOfSpeech?: string;
  meaning: string;
  sourceSong?: string;
  sourceSongId?: string;
  sourceTime?: number;
  sourceLine?: string;
}) => {
  const db = await openLocalDb();
  try {
    const word = entry.word.trim().toLowerCase();
    const lookedUpAt = new Date().toISOString();
    const transaction = db.transaction(WORD_LOOKUP_STORE, "readwrite");
    const store = transaction.objectStore(WORD_LOOKUP_STORE);
    const existing = await requestToPromise<LocalWordLookupRecord | undefined>(store.get(word));
    const sourceSongs = mergeWordLookupSongRefs(existing?.sourceSongs, entry, lookedUpAt);
    store.put({
      word,
      phonetic: entry.phonetic,
      usPhonetic: entry.usPhonetic,
      ukPhonetic: entry.ukPhonetic,
      partOfSpeech: entry.partOfSpeech,
      meaning: entry.meaning,
      lookupCount: (existing?.lookupCount ?? 0) + 1,
      lastLookedUpAt: lookedUpAt,
      sourceSongs,
      songCount: sourceSongs.length,
    });
    await transactionDone(transaction);
  } finally {
    db.close();
  }
};

export const recordLocalStudyHeartbeat = async ({
  seconds = 0,
  songId,
}: {
  seconds?: number;
  songId?: string;
}) => {
  const db = await openLocalDb();
  try {
    const dateKey = todayKey();
    const transaction = db.transaction(STUDY_STORE, "readwrite");
    const store = transaction.objectStore(STUDY_STORE);
    const existing = await requestToPromise<LocalStudyDayRecord | undefined>(store.get(dateKey));
    const learnedSongIds = new Set(existing?.learnedSongIds ?? []);
    if (songId) {
      learnedSongIds.add(songId);
    }
    store.put({
      dateKey,
      totalSeconds: Math.max(0, Math.round((existing?.totalSeconds ?? 0) + seconds)),
      learnedSongIds: [...learnedSongIds],
      lastStudiedAt: new Date().toISOString(),
    });
    await transactionDone(transaction);
  } finally {
    db.close();
  }
};

export const buildLocalProfileStats = async (): Promise<UserProfileStats> => {
  const [studyDays, vocabulary, favorites] = await Promise.all([
    getAll<LocalStudyDayRecord>(STUDY_STORE),
    getAll<SavedWord>(VOCABULARY_STORE),
    getAll<LocalFavoriteRecord>(FAVORITE_STORE),
  ]);
  const totalStudySeconds = studyDays.reduce((sum, day) => sum + day.totalSeconds, 0);
  const today = studyDays.find((day) => day.dateKey === todayKey());

  return {
    cumulativeDays: studyDays.filter((day) => day.totalSeconds > 0).length,
    masteredWords: vocabulary.length,
    conqueredSentences: 0,
    favoriteSongs: favorites.length,
    totalStudySeconds,
    totalStudyMinutes: Math.round(totalStudySeconds / 60),
    streakDays: countLocalStreak(studyDays),
    todayStudied: Boolean(today && today.totalSeconds > 0),
    todaySeconds: today?.totalSeconds ?? 0,
    studyCurve: buildLocalStudyCurve(studyDays),
  };
};
