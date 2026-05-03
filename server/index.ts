import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { config } from "dotenv";
import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

config({ path: ".env.local" });
config();

const prisma = new PrismaClient();
const app = Fastify({
  logger: true,
});
app.removeContentTypeParser("application/json");
app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
  const rawBody = typeof body === "string" ? body : body.toString("utf8");

  if (rawBody.trim().length === 0) {
    done(null, {});
    return;
  }

  try {
    done(null, JSON.parse(rawBody));
  } catch (error) {
    done(error instanceof Error ? error : new Error("Invalid JSON body"), undefined);
  }
});
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const uploadRoot = path.join(projectRoot, "server", "uploads");
const ttsRoot = path.join(uploadRoot, "tts");
const youtubeRoot = path.join(uploadRoot, "youtube");
const dictionaryRoot = path.join(projectRoot, "server", "dictionaries");
const ecdictCsvPath = path.join(dictionaryRoot, "ecdict.csv");
const YOUTUBE_SEARCH_LIMIT = 20;
const AUTH_SESSION_TTL_DAYS = Number(process.env.AUTH_SESSION_TTL_DAYS ?? 7);
const execFileAsync = promisify(execFile);
const wechatLoginSessions = new Map<string, WechatLoginSession>();

type VocabularyPayload = {
  word?: string;
  phonetic?: string;
  meaning?: string;
  example?: string;
  sourceSong?: string;
  sourceSongId?: string;
  sourceTime?: number | string;
  sourceLine?: string;
};

type TtsPayload = {
  text?: string;
  lang?: string;
  voice?: string;
  speed?: number | string;
  volume?: number | string;
  pitch?: number | string;
};

type XfTtsFrame = {
  code: number;
  message?: string;
  sid?: string;
  data?: {
    audio?: string;
    status?: number;
  } | null;
};

type DictionaryEntry = {
  word: string;
  phonetic?: string;
  usPhonetic?: string;
  ukPhonetic?: string;
  partOfSpeech?: string;
  meaning: string;
  enMeaning?: string;
  example?: string;
  source: string;
};

type DictionaryLookupResult = DictionaryEntry & {
  pronunciation: {
    engine: string;
    lang: string;
    accent: string;
  };
};

type DictionaryApiEntry = {
  word: string;
  phonetic?: string;
  phonetics?: Array<{ text?: string; audio?: string }>;
  meanings?: Array<{
    partOfSpeech?: string;
    definitions?: Array<{ definition?: string; example?: string }>;
  }>;
};

type AuthPayload = {
  email?: string;
  password?: string;
  displayName?: string;
};

type WechatCheckQuery = {
  sessionId?: string;
};

type WechatLoginSession = {
  id: string;
  expiresAt: number;
  code: string;
};

type FavoriteSongPayload = {
  id?: string;
  title?: string;
  artist?: string;
  audioUrl?: string;
  coverUrl?: string;
  lyrics?: Array<{ id: string; time: number; text: string }>;
};

type SongLyricsPayload = {
  lyrics?: Array<{ id?: string; time?: number | string; text?: string }>;
};

type ProfilePayload = {
  displayName?: string;
  avatarUrl?: string;
  bio?: string;
  levelTitle?: string;
  cumulativeDays?: number;
  masteredWords?: number;
  conqueredSentences?: number;
};

type StudyHeartbeatPayload = {
  seconds?: number | string;
  songId?: string;
  songTitle?: string;
  dateKey?: string;
};

type YouTubeSearchItem = {
  id?: {
    videoId?: string;
  };
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: {
      default?: { url?: string };
      medium?: { url?: string };
      high?: { url?: string };
    };
  };
};

type YouTubeSearchResponse = {
  items?: YouTubeSearchItem[];
};

type YouTubeSearchResult = {
  id: string;
  title: string;
  channelTitle: string;
  description: string;
  publishedAt?: string;
  thumbnailUrl?: string;
  url: string;
  sourceType?: "youtube" | "local";
  song?: unknown;
};

type YouTubeDownloadPayload = {
  videoId?: string;
  title?: string;
  channelTitle?: string;
  thumbnailUrl?: string;
};

type LyricLine = {
  id: string;
  time: number;
  text: string;
};

type LrcLibTrack = {
  id?: number;
  name?: string;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
};

type YouTubeVideoInfo = {
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
};

const fallbackDictionary: Record<
  string,
  { phonetic?: string; partOfSpeech?: string; meaning: string; example?: string }
> = {
  heard: {
    phonetic: "/hɝːd/",
    partOfSpeech: "verb",
    meaning: "听见；听说。Past tense of hear.",
    example: "I heard your voice.",
  },
  love: {
    phonetic: "/lʌv/",
    partOfSpeech: "noun/verb",
    meaning: "爱；喜爱。",
    example: "Sometimes it lasts in love.",
  },
  settled: {
    phonetic: "/ˈset̬əld/",
    partOfSpeech: "adjective/verb",
    meaning: "安定下来的；定居的。",
    example: "You're settled down.",
  },
  echoes: {
    phonetic: "/ˈekoʊz/",
    partOfSpeech: "noun",
    meaning: "回声；共鸣。",
    example: "The walls repeat the echoes.",
  },
};
const localDictionary = new Map<string, DictionaryEntry>();

await app.register(cors, {
  origin: true,
});
await app.register(multipart, {
  limits: {
    fileSize: 300 * 1024 * 1024,
  },
});
await mkdir(uploadRoot, { recursive: true });
await mkdir(ttsRoot, { recursive: true });
await mkdir(youtubeRoot, { recursive: true });
await mkdir(dictionaryRoot, { recursive: true });
await app.register(fastifyStatic, {
  root: uploadRoot,
  prefix: "/uploads/",
});

app.get("/api/health", async () => ({ ok: true }));

const getFavoriteKey = (song: { id?: string | null; title: string; artist: string }) =>
  song.id ? `id:${song.id}` : `song:${song.title.trim().toLowerCase()}::${song.artist.trim().toLowerCase()}`;

const isDemoAccountEmail = (email: string) =>
  email === "demo@melomemo.local" || (email.startsWith("wechat_") && email.endsWith("@melomemo.local"));

const hashPassword = (password: string) => {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
};

const verifyPassword = (password: string, passwordHash: string) => {
  const [salt, savedHash] = passwordHash.split(":");
  if (!salt || !savedHash) {
    return false;
  }

  const hash = scryptSync(password, salt, 64);
  const saved = Buffer.from(savedHash, "hex");
  return saved.length === hash.length && timingSafeEqual(hash, saved);
};

const hashAuthToken = (token: string) => createHash("sha256").update(token).digest("hex");

const createAuthSession = async (userId: string) => {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + AUTH_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.authSession.create({
    data: {
      userId,
      tokenHash: hashAuthToken(token),
      expiresAt,
    },
  });

  return {
    token,
    expiresAt: expiresAt.toISOString(),
  };
};

const publicUser = (user: {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  levelTitle: string;
}) => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  avatarUrl: user.avatarUrl ?? undefined,
  bio: user.bio,
  levelTitle: user.levelTitle,
});

const authResponse = async (user: Parameters<typeof publicUser>[0]) => ({
  user: publicUser(user),
  session: await createAuthSession(user.id),
});

const ensureUserProfile = async (userId: string) =>
  prisma.userProfile.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      cumulativeDays: 0,
      masteredWords: 0,
      conqueredSentences: 0,
    },
  });

const getRequestUser = async (request: { headers: Record<string, string | string[] | undefined> }) => {
  const authorizationHeader = request.headers.authorization;
  const authorization = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader;
  const sessionTokenHeader = request.headers["x-session-token"];
  const sessionToken = Array.isArray(sessionTokenHeader) ? sessionTokenHeader[0] : sessionTokenHeader;
  const bearerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const token = bearerToken || sessionToken?.trim();

  if (!token) {
    return null;
  }

  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashAuthToken(token) },
    include: { user: true },
  });

  if (!session || session.expiresAt <= new Date() || isDemoAccountEmail(session.user.email)) {
    if (session) {
      await prisma.authSession.delete({ where: { id: session.id } }).catch(() => null);
    }
    return null;
  }

  await ensureUserProfile(session.user.id);
  return session.user;
};

const requireRequestUser = async (
  request: { headers: Record<string, string | string[] | undefined> },
  reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } },
) => {
  const user = await getRequestUser(request);
  if (!user) {
    reply.code(401).send({ message: "请先登录。" });
    return null;
  }
  return user;
};

const STUDY_TIME_ZONE = process.env.APP_TIME_ZONE || "Asia/Shanghai";

const getStudyDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: STUDY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const getPart = (type: string) => parts.find((part) => part.type === type)?.value ?? "";

  return `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
};

const isValidDateKey = (value?: string) => Boolean(value?.match(/^\d{4}-\d{2}-\d{2}$/));

const addDaysToDateKey = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const getStudyDayLabel = (dateKey: string) => {
  const labels = ["日", "一", "二", "三", "四", "五", "六"];
  return labels[new Date(`${dateKey}T00:00:00.000Z`).getUTCDay()];
};

const parseStudySongIds = (value: string) => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

const normalizeStudySeconds = (value: number | string | undefined) => {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return 0;
  }

  return Math.min(300, Math.max(0, Math.round(numberValue)));
};

const buildStudyStats = async (userId: string, conqueredSentences = 0) => {
  const [studyDays, favoriteSongCount, masteredWords] = await Promise.all([
    prisma.userStudyDay.findMany({
      where: { userId },
      orderBy: { dateKey: "asc" },
    }),
    prisma.userFavoriteSong.count({
      where: { userId },
    }),
    prisma.vocabularyWord.count({
      where: { userId },
    }),
  ]);
  const dayMap = new Map(studyDays.map((day) => [day.dateKey, day]));
  const todayKey = getStudyDateKey();
  const streakAnchor = dayMap.has(todayKey) ? todayKey : addDaysToDateKey(todayKey, -1);
  let streakDays = 0;

  for (let dateKey = streakAnchor; dayMap.has(dateKey); dateKey = addDaysToDateKey(dateKey, -1)) {
    streakDays += 1;
  }

  const totalStudySeconds = studyDays.reduce((total, day) => total + day.totalSeconds, 0);
  const studyCurve = Array.from({ length: 30 }, (_, index) => {
    const dateKey = addDaysToDateKey(todayKey, index - 29);
    const day = dayMap.get(dateKey);
    return {
      dateKey,
      day: index === 29 ? "今天" : getStudyDayLabel(dateKey),
      minutes: day ? Math.round(day.totalSeconds / 60) : 0,
      studied: Boolean(day),
    };
  });
  const todayStudy = dayMap.get(todayKey);

  return {
    cumulativeDays: studyDays.length,
    masteredWords,
    conqueredSentences,
    favoriteSongs: favoriteSongCount,
    totalStudySeconds,
    totalStudyMinutes: Math.round(totalStudySeconds / 60),
    streakDays,
    todayStudied: Boolean(todayStudy),
    todaySeconds: todayStudy?.totalSeconds ?? 0,
    studyCurve,
  };
};

const sanitizeFileName = (value: string) =>
  value
    .replace(/[^\w.\-\u4e00-\u9fa5]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "file";

const buildYouTubeUploadUrl = (...segments: string[]) =>
  `/uploads/youtube/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;

const uploadUrlToFilePath = (url?: string) => {
  if (!url?.startsWith("/uploads/")) {
    return undefined;
  }

  const relativePath = decodeURIComponent(url.replace(/^\/uploads\//, ""));
  const filePath = path.resolve(uploadRoot, relativePath);
  const safeUploadRoot = path.resolve(uploadRoot);
  if (filePath !== safeUploadRoot && !filePath.startsWith(`${safeUploadRoot}${path.sep}`)) {
    return undefined;
  }

  return filePath;
};

const normalizeTtsText = (value?: string) =>
  (value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

const normalizeTtsCacheText = (value: string) => value.toLocaleLowerCase("en-US");

const normalizeYouTubeVideoId = (value?: string) =>
  (value ?? "").trim().match(/^[a-zA-Z0-9_-]{6,32}$/)?.[0] ?? "";

const normalizeLyricsPayload = (lyrics: SongLyricsPayload["lyrics"]) =>
  (lyrics ?? [])
    .map((line, index) => {
      const text = line.text?.trim();
      const timeValue = Number(line.time);

      if (!text) {
        return null;
      }

      return {
        id: line.id?.trim() || `line-${index}`,
        time: Number.isFinite(timeValue) ? Math.max(0, timeValue) : index * 4,
        text,
      };
    })
    .filter((line): line is { id: string; time: number; text: string } => Boolean(line));

const decodeHtmlEntities = (value: string) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const cleanSongText = (value?: string) =>
  decodeHtmlEntities(value ?? "")
    .replace(/\[[^\]]*(?:official|music video|lyrics?|lyric video|audio|visuali[sz]er|mv|hd|4k)[^\]]*\]/gi, "")
    .replace(/\([^)]*(?:official|music video|lyrics?|lyric video|audio|visuali[sz]er|mv|hd|4k)[^)]*\)/gi, "")
    .replace(/\s+(?:official\s+)?(?:music\s+video|lyrics?|lyric\s+video|audio|visuali[sz]er|mv)\s*$/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+[-|]\s*$/g, "")
    .trim();

const normalizeArtistName = (value?: string) =>
  cleanSongText(value)
    .replace(/\s*-\s*Topic$/i, "")
    .replace(/\s*VEVO$/i, "")
    .trim();

const getSongIdentity = ({
  title,
  artist,
}: {
  title?: string;
  artist?: string;
}) => {
  const cleanedTitle = cleanSongText(title);
  const cleanedArtist = normalizeArtistName(artist);
  const titleParts = cleanedTitle.split(/\s+-\s+/).map((part) => cleanSongText(part)).filter(Boolean);

  if (titleParts.length >= 2) {
    return {
      title: titleParts.slice(1).join(" - ") || cleanedTitle,
      artist: titleParts[0] || cleanedArtist || "YouTube",
    };
  }

  return {
    title: cleanedTitle || "YouTube Song",
    artist: cleanedArtist || "YouTube",
  };
};

const clampNumber = (value: number | string | undefined, fallback: number) => {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  return Math.min(100, Math.max(0, Math.round(numberValue)));
};

const fileExists = async (filePath: string) => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const normalizeDictionaryWord = (value: string) => value.toLowerCase().replace(/[^a-z'-]/g, "");

const normalizeSearchQuery = (value?: string) =>
  (value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

const extractYouTubeText = (value: unknown): string | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const textValue = value as {
    simpleText?: string;
    runs?: Array<{ text?: string }>;
  };

  return textValue.simpleText || textValue.runs?.map((run) => run.text ?? "").join("").trim() || undefined;
};

const findYouTubeInitialData = (html: string) => {
  const marker = "var ytInitialData = ";
  const start = html.indexOf(marker);

  if (start < 0) {
    return null;
  }

  const jsonStart = start + marker.length;
  const jsonEnd = html.indexOf(";</script>", jsonStart);

  if (jsonEnd < 0) {
    return null;
  }

  try {
    return JSON.parse(html.slice(jsonStart, jsonEnd));
  } catch {
    return null;
  }
};

const collectYouTubeRenderers = (value: unknown, results: YouTubeSearchResult[]) => {
  if (!value || results.length >= YOUTUBE_SEARCH_LIMIT) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectYouTubeRenderers(item, results);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const current = value as Record<string, unknown> & {
    videoRenderer?: {
      videoId?: string;
      title?: unknown;
      ownerText?: unknown;
      longBylineText?: unknown;
      descriptionSnippet?: unknown;
      publishedTimeText?: unknown;
      thumbnail?: {
        thumbnails?: Array<{ url?: string }>;
      };
    };
  };
  const renderer = current.videoRenderer;

  if (renderer?.videoId && !results.some((result) => result.id === renderer.videoId)) {
    const title = extractYouTubeText(renderer.title);
    if (title) {
      const thumbnails = renderer.thumbnail?.thumbnails ?? [];
      const thumbnailUrl = thumbnails[thumbnails.length - 1]?.url;
      results.push({
        id: renderer.videoId,
        title,
        channelTitle: extractYouTubeText(renderer.ownerText) || extractYouTubeText(renderer.longBylineText) || "YouTube",
        description: extractYouTubeText(renderer.descriptionSnippet) || "",
        publishedAt: extractYouTubeText(renderer.publishedTimeText),
        thumbnailUrl,
        url: `https://www.youtube.com/watch?v=${renderer.videoId}`,
      });
    }
  }

  for (const child of Object.values(current)) {
    collectYouTubeRenderers(child, results);
  }
};

const searchYouTubePage = async (query: string) => {
  const params = new URLSearchParams({
    search_query: `${query} song`,
  });
  const response = await fetch(`https://www.youtube.com/results?${params.toString()}`, {
    headers: {
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      "user-agent": "Mozilla/5.0 MeloMemo",
    },
  });

  if (!response.ok) {
    throw new Error(`YouTube search page failed: ${response.status}`);
  }

  const data = findYouTubeInitialData(await response.text());
  const results: YouTubeSearchResult[] = [];
  collectYouTubeRenderers(data, results);
  return results;
};

const getFileByExtension = async (directory: string, extensions: string[]) => {
  const files = await readdir(directory);
  return files.find((file) => extensions.some((extension) => file.toLowerCase().endsWith(extension)));
};

const downloadRemoteCover = async (
  coverUrl: string | undefined,
  directory: string,
  urlDirectory: string,
  fileBaseName: string,
) => {
  if (!coverUrl?.trim()) {
    return undefined;
  }

  const response = await fetch(coverUrl);
  if (!response.ok) {
    return undefined;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const extension = contentType.includes("png") ? ".png" : contentType.includes("webp") ? ".webp" : ".jpg";
  const fileName = `${fileBaseName}-cover${extension}`;
  const filePath = path.join(directory, fileName);
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(filePath, buffer);
  return buildYouTubeUploadUrl(urlDirectory, fileName);
};

const removeUploadUrl = async (url?: string) => {
  const filePath = uploadUrlToFilePath(url);
  if (filePath) {
    await rm(filePath, { force: true });
  }
};

const removeSongStoredFiles = async (song: {
  audioUrl: string;
  coverUrl?: string | null;
  lyricsUrl?: string | null;
  sourceType?: string | null;
}) => {
  const audioFilePath = uploadUrlToFilePath(song.audioUrl);
  const audioDirectory = audioFilePath ? path.dirname(audioFilePath) : undefined;
  const isYouTubeSongDirectory =
    song.sourceType === "youtube" &&
    audioDirectory?.startsWith(path.resolve(youtubeRoot)) &&
    audioDirectory !== path.resolve(youtubeRoot);

  if (isYouTubeSongDirectory && audioDirectory) {
    await rm(audioDirectory, { recursive: true, force: true });
    return;
  }

  await Promise.all([
    removeUploadUrl(song.audioUrl),
    removeUploadUrl(song.coverUrl ?? undefined),
    removeUploadUrl(song.lyricsUrl ?? undefined),
  ]);
};

const isSongAudioAvailable = async (song: { audioUrl: string }) => {
  const audioFilePath = uploadUrlToFilePath(song.audioUrl);
  return audioFilePath ? fileExists(audioFilePath) : true;
};

const pruneMissingSongFiles = async <T extends {
  id: string;
  audioUrl: string;
  coverUrl?: string | null;
  lyricsUrl?: string | null;
  sourceType?: string | null;
}>(songs: T[]) => {
  const availableSongs: T[] = [];

  for (const song of songs) {
    if (await isSongAudioAvailable(song)) {
      availableSongs.push(song);
      continue;
    }

    await prisma.userFavoriteSong.deleteMany({ where: { songId: song.id } });
    await prisma.song.deleteMany({ where: { id: song.id } });
    await removeSongStoredFiles(song);
  }

  return availableSongs;
};

const parseTimestampSeconds = (value: string) => {
  const match = value.match(/(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?/);
  if (!match) {
    return 0;
  }

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  const fraction = Number((match[4] ?? "0").padEnd(3, "0"));
  return hours * 3600 + minutes * 60 + seconds + fraction / 1000;
};

const parseLrcLyrics = (rawLyrics: string): LyricLine[] => {
  const lines = rawLyrics
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const lyrics = lines.flatMap((line, index) => {
    if (/^\[(ti|ar|al|au|by|offset|length|re|ve):[^\]]*\]$/i.test(line)) {
      return [];
    }

    const matches = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.,](\d{1,3}))?\]/g)];
    const text = line.replace(/\[(\d{1,3}):(\d{2})(?:[.,](\d{1,3}))?\]/g, "").trim();

    if (matches.length === 0) {
      return text ? [{ id: `plain-${index}`, time: index * 4, text }] : [];
    }

    return matches.map((match, matchIndex) => {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = Number((match[3] ?? "0").padEnd(3, "0"));
      return {
        id: `lrc-${index}-${matchIndex}`,
        time: minutes * 60 + seconds + fraction / 1000,
        text: text || "♪",
      };
    });
  });

  return lyrics.sort((a, b) => a.time - b.time);
};

const parsePlainLyrics = (rawLyrics?: string | null): LyricLine[] =>
  (rawLyrics ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text, index) => ({
      id: `plain-${index}`,
      time: index * 4,
      text,
    }));

const stripWebVttTags = (value: string) =>
  value
    .replace(/<[^>]+>/g, "")
    .replace(/\{\\[^}]+\}/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();

const parseWebVttLyrics = (rawSubtitles: string): LyricLine[] => {
  const blocks = rawSubtitles.replace(/\r/g, "").split(/\n{2,}/);
  const seen = new Set<string>();
  const lines: LyricLine[] = [];

  blocks.forEach((block, index) => {
    const rows = block.split("\n").map((row) => row.trim()).filter(Boolean);
    const timingIndex = rows.findIndex((row) => row.includes("-->"));
    if (timingIndex < 0) {
      return;
    }

    const start = rows[timingIndex].split("-->")[0]?.trim();
    const text = stripWebVttTags(rows.slice(timingIndex + 1).join(" "))
      .replace(/\s+/g, " ")
      .trim();

    if (!start || !text || seen.has(`${start}:${text}`)) {
      return;
    }

    seen.add(`${start}:${text}`);
    lines.push({
      id: `caption-${index}`,
      time: parseTimestampSeconds(start),
      text,
    });
  });

  return lines.sort((a, b) => a.time - b.time);
};

const getYouTubeInfo = async (videoUrl: string): Promise<YouTubeVideoInfo> => {
  try {
    const { stdout } = await execFileAsync(
      "yt-dlp",
      ["--dump-single-json", "--no-playlist", "--skip-download", videoUrl],
      {
        timeout: 45000,
        maxBuffer: 1024 * 1024 * 8,
      },
    );
    return JSON.parse(stdout) as YouTubeVideoInfo;
  } catch {
    return {};
  }
};

const findBestLrcLibTrack = (tracks: LrcLibTrack[], duration?: number) => {
  const scored = tracks
    .filter((track) => track.syncedLyrics || track.plainLyrics || track.instrumental)
    .map((track) => {
      const durationDelta = Number.isFinite(duration) && Number.isFinite(track.duration)
        ? Math.abs(Number(track.duration) - Number(duration))
        : 999;
      const lyricsScore = track.syncedLyrics ? 0 : track.plainLyrics ? 20 : 50;
      return {
        track,
        score: lyricsScore + Math.min(durationDelta, 300),
      };
    })
    .sort((a, b) => a.score - b.score);

  return scored[0]?.track;
};

const searchLrcLibLyrics = async ({
  title,
  artist,
  duration,
}: {
  title: string;
  artist: string;
  duration?: number;
}) => {
  const params = new URLSearchParams({
    track_name: title,
    artist_name: artist,
  });

  if (Number.isFinite(duration)) {
    params.set("duration", String(Math.round(duration ?? 0)));
  }

  const response = await fetch(`https://lrclib.net/api/search?${params.toString()}`, {
    headers: {
      "accept": "application/json",
      "user-agent": "MeloMemo/0.1.0 (local lyrics lookup)",
    },
  });

  if (!response.ok) {
    throw new Error(`LRCLIB lookup failed: ${response.status}`);
  }

  const tracks = (await response.json()) as LrcLibTrack[];
  const bestTrack = findBestLrcLibTrack(Array.isArray(tracks) ? tracks : [], duration);

  if (!bestTrack || bestTrack.instrumental) {
    return [];
  }

  if (bestTrack.syncedLyrics?.trim()) {
    return parseLrcLyrics(bestTrack.syncedLyrics);
  }

  return parsePlainLyrics(bestTrack.plainLyrics);
};

const buildLrcLibLyricCandidates = (tracks: LrcLibTrack[], duration?: number) =>
  tracks
    .filter((track) => !track.instrumental && (track.syncedLyrics || track.plainLyrics))
    .map((track) => {
      const lyrics = track.syncedLyrics?.trim()
        ? parseLrcLyrics(track.syncedLyrics)
        : parsePlainLyrics(track.plainLyrics);
      const durationDelta = Number.isFinite(duration) && Number.isFinite(track.duration)
        ? Math.abs(Number(track.duration) - Number(duration))
        : 999;

      return {
        id: String(track.id ?? `${track.artistName}-${track.name || track.trackName}`),
        title: track.name || track.trackName || "Unknown Title",
        artist: track.artistName || "Unknown Artist",
        album: track.albumName,
        duration: track.duration,
        lyricType: track.syncedLyrics?.trim() ? "synced" : "plain",
        lineCount: lyrics.length,
        lyrics,
        score: (track.syncedLyrics ? 0 : 20) + Math.min(durationDelta, 300),
      };
    })
    .filter((candidate) => candidate.lyrics.length > 0)
    .sort((a, b) => a.score - b.score)
    .slice(0, 10);

const searchLrcLibLyricCandidates = async ({
  title,
  artist,
  duration,
}: {
  title: string;
  artist: string;
  duration?: number;
}) => {
  const params = new URLSearchParams({
    track_name: title,
    artist_name: artist,
  });

  if (Number.isFinite(duration)) {
    params.set("duration", String(Math.round(duration ?? 0)));
  }

  const response = await fetch(`https://lrclib.net/api/search?${params.toString()}`, {
    headers: {
      "accept": "application/json",
      "user-agent": "MeloMemo/0.1.0 (manual lyrics lookup)",
    },
  });

  if (!response.ok) {
    throw new Error(`LRCLIB lookup failed: ${response.status}`);
  }

  const tracks = (await response.json()) as LrcLibTrack[];
  return buildLrcLibLyricCandidates(Array.isArray(tracks) ? tracks : [], duration);
};

const searchYouTubeCaptionLyrics = async (videoUrl: string) => {
  const tempRoot = path.join(youtubeRoot, "tmp");
  const tempDir = path.join(tempRoot, `${Date.now()}-captions`);
  await mkdir(tempDir, { recursive: true });

  try {
    await execFileAsync(
      "yt-dlp",
      [
        "--skip-download",
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs",
        "en.*,zh-Hans,zh-Hant,zh.*",
        "--sub-format",
        "vtt",
        "--convert-subs",
        "vtt",
        "--no-playlist",
        "--no-progress",
        "-o",
        path.join(tempDir, "captions.%(ext)s"),
        videoUrl,
      ],
      {
        timeout: 60000,
        maxBuffer: 1024 * 1024 * 8,
      },
    );

    const subtitleFile = await getFileByExtension(tempDir, [".en.vtt", ".en-us.vtt", ".en-gb.vtt", ".vtt"]);
    if (!subtitleFile) {
      return [];
    }

    return parseWebVttLyrics(await readFile(path.join(tempDir, subtitleFile), "utf8"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const searchLyricsForDownloadedSong = async ({
  title,
  artist,
  duration,
  sourceUrl,
}: {
  title: string;
  artist: string;
  duration?: number;
  sourceUrl: string;
}) => {
  try {
    const lrcLibLyrics = await searchLrcLibLyrics({ title, artist, duration });
    if (lrcLibLyrics.length > 0) {
      return lrcLibLyrics;
    }
  } catch (error) {
    app.log.warn(error, "LRCLIB lyrics lookup failed.");
  }

  try {
    return await searchYouTubeCaptionLyrics(sourceUrl);
  } catch (error) {
    app.log.warn(error, "YouTube caption lyrics fallback failed.");
    return [];
  }
};

const downloadYouTubeAudio = async ({
  videoId,
  fallbackTitle,
  fallbackArtist,
  fallbackThumbnailUrl,
}: {
  videoId: string;
  fallbackTitle?: string;
  fallbackArtist?: string;
  fallbackThumbnailUrl?: string;
}) => {
  const tempRoot = path.join(youtubeRoot, "tmp");
  const tempDir = path.join(tempRoot, `${Date.now()}-${videoId}`);
  await mkdir(tempDir, { recursive: true });

  try {
    const outputTemplate = path.join(tempDir, "download.%(ext)s");
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const videoInfo = await getYouTubeInfo(videoUrl);
    const identity = getSongIdentity({
      title: fallbackTitle || videoInfo.title,
      artist: fallbackArtist || videoInfo.uploader || videoInfo.channel,
    });
    const safeSongName = sanitizeFileName(identity.title || fallbackTitle || "youtube-song");
    const safeFolderName = sanitizeFileName(`${identity.title || fallbackTitle || "youtube-song"}-${videoId}`);
    const finalDir = path.join(youtubeRoot, safeFolderName);
    await mkdir(finalDir, { recursive: true });

    await execFileAsync(
      "yt-dlp",
      [
        "--no-playlist",
        "--extract-audio",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "0",
        "--write-thumbnail",
        "--convert-thumbnails",
        "jpg",
        "--embed-metadata",
        "--no-progress",
        "-o",
        outputTemplate,
        videoUrl,
      ],
      {
        timeout: 180000,
        maxBuffer: 1024 * 1024 * 8,
      },
    );

    const audioFile = await getFileByExtension(tempDir, [".mp3"]);
    if (!audioFile) {
      throw new Error("没有生成 MP3 文件。");
    }

    const coverFile = await getFileByExtension(tempDir, [".jpg", ".jpeg", ".png", ".webp"]);
    const finalAudioName = `${safeSongName}.mp3`;
    const finalCoverName = coverFile ? `${safeSongName}${path.extname(coverFile).toLowerCase() || ".jpg"}` : undefined;
    const finalLyricsName = `${safeSongName}.lyrics.json`;

    await rename(path.join(tempDir, audioFile), path.join(finalDir, finalAudioName));
    if (coverFile && finalCoverName) {
      await rename(path.join(tempDir, coverFile), path.join(finalDir, finalCoverName));
    }
    const coverUrl = finalCoverName
      ? buildYouTubeUploadUrl(safeFolderName, finalCoverName)
      : await downloadRemoteCover(fallbackThumbnailUrl, finalDir, safeFolderName, safeSongName);

    return {
      title: identity.title,
      artist: identity.artist,
      duration: Number.isFinite(videoInfo.duration) ? Number(videoInfo.duration) : undefined,
      audioUrl: buildYouTubeUploadUrl(safeFolderName, finalAudioName),
      coverUrl,
      lyricsUrl: buildYouTubeUploadUrl(safeFolderName, finalLyricsName),
      lyricsFilePath: path.join(finalDir, finalLyricsName),
      sourceUrl: videoUrl,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const parseCsvLine = (line: string) => {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === "\"") {
      if (quoted && nextCharacter === "\"") {
        cell += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (character === "," && !quoted) {
      cells.push(cell);
      cell = "";
      continue;
    }

    cell += character;
  }

  cells.push(cell);
  return cells;
};

const cleanEcdictText = (value?: string) =>
  value
    ?.replace(/\\n/g, "\n")
    .replace(/\r/g, "")
    .trim();

const partOfSpeechLabels: Record<string, string> = {
  n: "n. 名词",
  noun: "n. 名词",
  v: "v. 动词",
  verb: "v. 动词",
  vt: "vt. 及物动词",
  vi: "vi. 不及物动词",
  a: "adj. 形容词",
  s: "adj. 形容词",
  adj: "adj. 形容词",
  adjective: "adj. 形容词",
  ad: "adv. 副词",
  adv: "adv. 副词",
  adverb: "adv. 副词",
  prep: "prep. 介词",
  preposition: "prep. 介词",
  conj: "conj. 连词",
  conjunction: "conj. 连词",
  pron: "pron. 代词",
  pronoun: "pron. 代词",
  num: "num. 数词",
  interj: "int. 感叹词",
  int: "int. 感叹词",
  abbr: "abbr. 缩写",
  suf: "suf. 后缀",
  pref: "pref. 前缀",
};

const normalizePartOfSpeech = (value?: string) => {
  const key = value?.toLowerCase().replace(/\.$/, "").trim();
  if (!key) {
    return undefined;
  }

  return partOfSpeechLabels[key] || value?.trim();
};

const extractPartOfSpeech = (...texts: Array<string | undefined>) => {
  const parts = new Set<string>();

  for (const text of texts) {
    const matches = text?.matchAll(/(?:^|\n)\s*([a-z]{1,8})\./gi);
    for (const match of matches ?? []) {
      const part = normalizePartOfSpeech(match[1]);
      if (part) {
        parts.add(part);
      }
    }
  }

  return parts.size > 0 ? Array.from(parts).join(" / ") : undefined;
};

const getFirstExample = (definition?: string) => {
  const text = cleanEcdictText(definition);
  if (!text) {
    return undefined;
  }

  return text
    .split("\n")
    .find((line) => /^[A-Z0-9][^。？！]*[.!?]$/.test(line.trim()))
    ?.trim();
};

const loadLocalDictionary = async () => {
  if (!(await fileExists(ecdictCsvPath))) {
    app.log.warn(`Local ECDICT file not found at ${ecdictCsvPath}. Run npm run dict:download to enable offline lookup.`);
    return;
  }

  const csv = await readFile(ecdictCsvPath, "utf8");
  const [headerLine, ...lines] = csv.split(/\n/);
  const headers = parseCsvLine(headerLine);
  const wordIndex = headers.indexOf("word");
  const phoneticIndex = headers.indexOf("phonetic");
  const definitionIndex = headers.indexOf("definition");
  const translationIndex = headers.indexOf("translation");
  const partOfSpeechIndex = headers.indexOf("pos");

  if (wordIndex < 0 || translationIndex < 0) {
    app.log.warn("Local ECDICT file has an unexpected header.");
    return;
  }

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    const cells = parseCsvLine(line);
    const word = normalizeDictionaryWord(cells[wordIndex] ?? "");
    const translation = cleanEcdictText(cells[translationIndex]);

    if (!word || !translation || localDictionary.has(word)) {
      continue;
    }

    const definition = cleanEcdictText(cells[definitionIndex]);
    localDictionary.set(word, {
      word,
      phonetic: cleanEcdictText(cells[phoneticIndex]),
      partOfSpeech:
        normalizePartOfSpeech(cleanEcdictText(cells[partOfSpeechIndex])) ||
        extractPartOfSpeech(translation, definition),
      meaning: translation,
      enMeaning: definition,
      example: getFirstExample(definition),
      source: "ECDICT local dictionary",
    });
  }

  app.log.info(`Loaded ${localDictionary.size} local dictionary entries from ECDICT.`);
};
await loadLocalDictionary();

const lookupDictionaryApi = async (word: string): Promise<Partial<DictionaryEntry>> => {
  const response = await fetch(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
  );

  if (!response.ok) {
    throw new Error(`Dictionary lookup failed: ${response.status}`);
  }

  const [entry] = (await response.json()) as DictionaryApiEntry[];
  const firstMeaning = entry?.meanings?.[0];
  const firstDefinition = firstMeaning?.definitions?.[0];
  const phonetics = entry?.phonetics ?? [];
  const getAccentPhonetic = (accent: "us" | "uk") =>
    phonetics.find((item) => item.text && item.audio?.toLowerCase().includes(`-${accent}.`))?.text;
  const firstPhonetic = entry?.phonetic || phonetics.find((item) => item.text)?.text;

  return {
    word: entry?.word ?? word,
    phonetic: firstPhonetic,
    usPhonetic: getAccentPhonetic("us") || firstPhonetic,
    ukPhonetic: getAccentPhonetic("uk") || firstPhonetic,
    partOfSpeech: normalizePartOfSpeech(firstMeaning?.partOfSpeech),
    meaning: firstDefinition?.definition,
    enMeaning: firstDefinition?.definition,
    example: firstDefinition?.example,
    source: "Free Dictionary API",
  };
};

const recordWordLookup = async (userId: string, entry: DictionaryLookupResult) => {
  await prisma.userWordLookup.upsert({
    where: {
      userId_word: {
        userId,
        word: entry.word,
      },
    },
    update: {
      phonetic: entry.phonetic,
      usPhonetic: entry.usPhonetic,
      ukPhonetic: entry.ukPhonetic,
      partOfSpeech: entry.partOfSpeech,
      meaning: entry.meaning,
      lookupCount: {
        increment: 1,
      },
      lastLookedUpAt: new Date(),
    },
    create: {
      userId,
      word: entry.word,
      phonetic: entry.phonetic,
      usPhonetic: entry.usPhonetic,
      ukPhonetic: entry.ukPhonetic,
      partOfSpeech: entry.partOfSpeech,
      meaning: entry.meaning,
      lookupCount: 1,
      lastLookedUpAt: new Date(),
    },
  });
};

const buildXfYunAuthUrl = () => {
  const host = "tts-api.xfyun.cn";
  const requestPath = "/v2/tts";
  const date = new Date().toUTCString();
  const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${requestPath} HTTP/1.1`;
  const signature = createHmac("sha256", process.env.XF_API_SECRET ?? "")
    .update(signatureOrigin)
    .digest("base64");
  const authorizationOrigin = `api_key="${process.env.XF_API_KEY}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const authorization = Buffer.from(authorizationOrigin).toString("base64");
  const params = new URLSearchParams({
    authorization,
    date,
    host,
  });

  return `wss://${host}${requestPath}?${params.toString()}`;
};

const getTtsVoice = (payload: TtsPayload) => {
  if (payload.voice?.trim()) {
    return payload.voice.trim();
  }

  if (payload.lang === "en-GB") {
    return process.env.XF_TTS_EN_GB_VOICE || process.env.XF_TTS_VOICE || "mary";
  }

  return process.env.XF_TTS_EN_US_VOICE || process.env.XF_TTS_VOICE || "catherine";
};

const synthesizeWithXfYun = async ({
  text,
  voice,
  speed,
  volume,
  pitch,
}: {
  text: string;
  voice: string;
  speed: number;
  volume: number;
  pitch: number;
}) =>
  new Promise<Buffer>((resolve, reject) => {
    const appId = process.env.XF_APPID;

    if (!appId || !process.env.XF_API_KEY || !process.env.XF_API_SECRET) {
      reject(new Error("讯飞 TTS 环境变量未配置。"));
      return;
    }

    const socket = new WebSocket(buildXfYunAuthUrl());
    const audioChunks: Buffer[] = [];
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      socket.close(1000);
      reject(new Error("讯飞 TTS 合成超时。"));
    }, 18000);

    const fail = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      socket.close(1000);
      reject(error);
    };

    socket.on("open", () => {
      socket.send(JSON.stringify({
        common: {
          app_id: appId,
        },
        business: {
          aue: "lame",
          sfl: 1,
          auf: "audio/L16;rate=16000",
          vcn: voice,
          speed,
          volume,
          pitch,
          bgs: 0,
          tte: "UTF8",
          reg: "0",
        },
        data: {
          status: 2,
          text: Buffer.from(text, "utf8").toString("base64"),
        },
      }));
    });

    socket.on("message", (rawMessage) => {
      let frame: XfTtsFrame;

      try {
        frame = JSON.parse(rawMessage.toString()) as XfTtsFrame;
      } catch {
        fail(new Error("讯飞 TTS 返回了无法解析的数据。"));
        return;
      }

      if (frame.code !== 0) {
        fail(new Error(frame.message || `讯飞 TTS 合成失败：${frame.code}`));
        return;
      }

      if (frame.data?.audio) {
        audioChunks.push(Buffer.from(frame.data.audio, "base64"));
      }

      if (frame.data?.status === 2) {
        if (audioChunks.length === 0) {
          fail(new Error("讯飞 TTS 没有返回音频数据。"));
          return;
        }

        settled = true;
        clearTimeout(timeout);
        socket.close(1000);
        resolve(Buffer.concat(audioChunks));
      }
    });

    socket.on("error", (error) => fail(error instanceof Error ? error : new Error("讯飞 TTS 连接失败。")));
    socket.on("close", (code) => {
      if (!settled && code !== 1000) {
        fail(new Error(`讯飞 TTS 连接异常关闭：${code}`));
      }
    });
  });

const normalizeSong = (song: {
  id: string;
  userId?: string | null;
  title: string;
  artist: string;
  audioUrl: string;
  coverUrl: string | null;
  lyrics: string;
  lyricsUrl?: string | null;
  sourceType?: string;
  sourceUrl?: string | null;
  externalId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  ...song,
  coverUrl: song.coverUrl ?? undefined,
  lyricsUrl: song.lyricsUrl ?? undefined,
  sourceUrl: song.sourceUrl ?? undefined,
  externalId: song.externalId ?? undefined,
  lyrics: JSON.parse(song.lyrics),
});

const buildLocalSongSearchResult = (song: Parameters<typeof normalizeSong>[0]) => {
  const normalizedSong = normalizeSong(song);
  return {
    id: `local:${song.id}`,
    title: song.title,
    channelTitle: song.artist,
    description: "本地曲库",
    thumbnailUrl: song.coverUrl ?? undefined,
    url: song.sourceUrl ?? song.audioUrl,
    sourceType: "local" as const,
    song: normalizedSong,
  };
};

const writeSongLyricsFile = async (lyricsUrl: string | undefined | null, lyrics: LyricLine[]) => {
  const lyricsFilePath = uploadUrlToFilePath(lyricsUrl ?? undefined);
  if (!lyricsFilePath) {
    return;
  }

  await mkdir(path.dirname(lyricsFilePath), { recursive: true });
  await writeFile(lyricsFilePath, JSON.stringify(lyrics, null, 2), "utf8");
};

const normalizeFavoriteSong = (favorite: {
  id: string;
  songId: string | null;
  favoriteKey: string;
  title: string;
  artist: string;
  audioUrl: string | null;
  coverUrl: string | null;
  lyrics: string | null;
  createdAt: Date;
}) => ({
  id: favorite.songId ?? undefined,
  favoriteId: favorite.favoriteKey,
  title: favorite.title,
  artist: favorite.artist,
  audioUrl: favorite.audioUrl ?? undefined,
  coverUrl: favorite.coverUrl ?? undefined,
  lyrics: favorite.lyrics ? JSON.parse(favorite.lyrics) : undefined,
  savedAt: favorite.createdAt.toISOString(),
});

app.post<{ Body: AuthPayload }>("/api/auth/register", async (request, reply) => {
  const email = request.body.email?.trim().toLowerCase();
  const password = request.body.password ?? "";
  const displayName = request.body.displayName?.trim() || "音律旅人";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return reply.code(400).send({ message: "请输入有效的邮箱地址。" });
  }

  if (password.length < 6) {
    return reply.code(400).send({ message: "密码至少需要 6 位。" });
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return reply.code(409).send({ message: "这个邮箱已经注册过了，请直接登录。" });
  }

  let user;
  try {
    user = await prisma.user.create({
      data: {
        email,
        passwordHash: hashPassword(password),
        displayName,
      },
    });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
      return reply.code(409).send({ message: "这个邮箱已经注册过了，请直接登录。" });
    }
    throw error;
  }
  await ensureUserProfile(user.id);

  return reply.code(201).send(await authResponse(user));
});

app.post<{ Body: AuthPayload }>("/api/auth/login", async (request, reply) => {
  const email = request.body.email?.trim().toLowerCase();
  const password = request.body.password ?? "";

  if (!email || !password) {
    return reply.code(400).send({ message: "email and password are required" });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || isDemoAccountEmail(user.email) || !verifyPassword(password, user.passwordHash)) {
    return reply.code(401).send({ message: "邮箱或密码不正确。" });
  }

  await ensureUserProfile(user.id);
  return authResponse(user);
});

app.post("/api/auth/logout", async (request, reply) => {
  const authorizationHeader = request.headers.authorization;
  const authorization = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader;
  const sessionTokenHeader = request.headers["x-session-token"];
  const sessionToken = Array.isArray(sessionTokenHeader) ? sessionTokenHeader[0] : sessionTokenHeader;
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || sessionToken?.trim();

  if (token) {
    await prisma.authSession.deleteMany({ where: { tokenHash: hashAuthToken(token) } });
  }

  return reply.code(204).send();
});

app.post("/api/auth/wechat/qr", async (_request, reply) => {
  if (!process.env.WECHAT_APP_ID) {
    return reply.code(503).send({ message: "微信登录未配置，请先使用邮箱登录。" });
  }

  const id = randomBytes(16).toString("hex");
  const code = randomBytes(3).toString("hex").toUpperCase();
  const now = Date.now();
  const redirectUri = process.env.WECHAT_REDIRECT_URI || "http://localhost:5175/api/auth/wechat/callback";
  const authUrl = `https://open.weixin.qq.com/connect/qrconnect?${new URLSearchParams({
    appid: process.env.WECHAT_APP_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "snsapi_login",
    state: id,
  }).toString()}#wechat_redirect`;
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?${new URLSearchParams({
    size: "220x220",
    margin: "12",
    data: authUrl,
  }).toString()}`;
  const session: WechatLoginSession = {
    id,
    code,
    expiresAt: now + 5 * 60 * 1000,
  };

  wechatLoginSessions.set(id, session);

  return {
    sessionId: id,
    code,
    authUrl,
    qrImageUrl,
    expiresAt: new Date(session.expiresAt).toISOString(),
  };
});

app.get<{ Querystring: WechatCheckQuery }>("/api/auth/wechat/check", async (request, reply) => {
  const sessionId = request.query.sessionId;
  const session = sessionId ? wechatLoginSessions.get(sessionId) : null;

  if (!session) {
    return reply.code(404).send({ message: "二维码已失效，请刷新后重试。" });
  }

  if (Date.now() > session.expiresAt) {
    wechatLoginSessions.delete(session.id);
    return reply.code(410).send({ message: "二维码已过期，请刷新后重试。" });
  }

  return {
    status: "pending",
    expiresAt: new Date(session.expiresAt).toISOString(),
  };
});

app.get("/api/auth/me", async (request, reply) => {
  const user = await requireRequestUser(request, reply);
  if (!user) {
    return;
  }
  return { user: publicUser(user) };
});

app.get("/api/profile", async (request, reply) => {
  const user = await requireRequestUser(request, reply);
  if (!user) {
    return;
  }
  const profile = await ensureUserProfile(user.id);
  const stats = await buildStudyStats(user.id, profile.conqueredSentences);

  return {
    user: publicUser(user),
    stats,
  };
});

app.patch<{ Body: ProfilePayload }>("/api/profile", async (request, reply) => {
  const user = await requireRequestUser(request, reply);
  if (!user) {
    return;
  }
  const userUpdate = {
    ...(request.body.displayName?.trim() ? { displayName: request.body.displayName.trim() } : {}),
    ...(typeof request.body.avatarUrl === "string" ? { avatarUrl: request.body.avatarUrl.trim() || null } : {}),
    ...(typeof request.body.bio === "string" ? { bio: request.body.bio.trim() } : {}),
    ...(typeof request.body.levelTitle === "string" ? { levelTitle: request.body.levelTitle.trim() } : {}),
  };
  const profileUpdate = {
    ...(Number.isInteger(request.body.cumulativeDays) ? { cumulativeDays: Math.max(0, request.body.cumulativeDays ?? 0) } : {}),
    ...(Number.isInteger(request.body.masteredWords) ? { masteredWords: Math.max(0, request.body.masteredWords ?? 0) } : {}),
    ...(Number.isInteger(request.body.conqueredSentences) ? { conqueredSentences: Math.max(0, request.body.conqueredSentences ?? 0) } : {}),
  };

  const [updatedUser, profile] = await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: userUpdate,
    }),
    prisma.userProfile.upsert({
      where: { userId: user.id },
      update: profileUpdate,
      create: {
        userId: user.id,
        cumulativeDays: profileUpdate.cumulativeDays ?? 0,
        masteredWords: profileUpdate.masteredWords ?? 0,
        conqueredSentences: profileUpdate.conqueredSentences ?? 0,
      },
    }),
  ]);
  const stats = await buildStudyStats(user.id, profile.conqueredSentences);

  return {
    user: publicUser(updatedUser),
    stats,
  };
});

app.post<{ Body: StudyHeartbeatPayload }>("/api/study/heartbeat", async (request) => {
  const user = await getRequestUser(request);
  if (!user) {
    return { stats: null };
  }
  const seconds = normalizeStudySeconds(request.body.seconds);
  const dateKey = isValidDateKey(request.body.dateKey) ? request.body.dateKey as string : getStudyDateKey();
  const songKey = request.body.songId?.trim() || request.body.songTitle?.trim();
  const existing = await prisma.userStudyDay.findUnique({
    where: {
      userId_dateKey: {
        userId: user.id,
        dateKey,
      },
    },
  });
  const learnedSongIds = new Set(existing ? parseStudySongIds(existing.learnedSongIds) : []);

  if (songKey) {
    learnedSongIds.add(songKey);
  }

  if (existing) {
    await prisma.userStudyDay.update({
      where: { id: existing.id },
      data: {
        totalSeconds: {
          increment: seconds,
        },
        learnedSongIds: JSON.stringify(Array.from(learnedSongIds)),
        lastStudiedAt: new Date(),
      },
    });
  } else {
    await prisma.userStudyDay.create({
      data: {
        userId: user.id,
        dateKey,
        totalSeconds: seconds,
        learnedSongIds: JSON.stringify(Array.from(learnedSongIds)),
        lastStudiedAt: new Date(),
      },
    });
  }

  const profile = await ensureUserProfile(user.id);
  return {
    stats: await buildStudyStats(user.id, profile.conqueredSentences),
  };
});

app.get("/api/vocabulary", async (request, reply) => {
  const user = await requireRequestUser(request, reply);
  if (!user) {
    return;
  }
  const words = await prisma.vocabularyWord.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return { words };
});

app.get("/api/songs", async (request, reply) => {
  const user = await requireRequestUser(request, reply);
  if (!user) {
    return;
  }
  const songs = await prisma.song.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  const availableSongs = await pruneMissingSongFiles(songs);

  return { songs: availableSongs.map(normalizeSong) };
});

app.delete<{ Params: { id: string } }>("/api/songs/:id", async (request, reply) => {
  const user = await requireRequestUser(request, reply);
  if (!user) {
    return;
  }
  const song = await prisma.song.findFirst({
    where: {
      id: request.params.id,
      userId: user.id,
    },
  });

  if (!song) {
    return reply.code(404).send({ message: "歌曲不存在或无权删除。" });
  }

  await prisma.$transaction([
    prisma.userFavoriteSong.deleteMany({ where: { songId: song.id } }),
    prisma.song.delete({ where: { id: song.id } }),
  ]);
  await removeSongStoredFiles(song);

  return reply.code(204).send();
});

app.get<{ Querystring: { title?: string; artist?: string; duration?: string } }>("/api/lyrics/search", async (request, reply) => {
  const title = normalizeSearchQuery(request.query.title);
  const artist = normalizeSearchQuery(request.query.artist);
  const duration = Number(request.query.duration);

  if (!title || !artist) {
    return reply.code(400).send({ message: "歌曲名和歌手名都需要填写。" });
  }

  try {
    const candidates = await searchLrcLibLyricCandidates({
      title,
      artist,
      duration: Number.isFinite(duration) ? duration : undefined,
    });

    return {
      results: candidates,
      source: "lrclib",
    };
  } catch (error) {
    request.log.error(error);
    return reply.code(502).send({
      message: "歌词搜索暂时不可用，请稍后再试。",
      source: "lrclib",
    });
  }
});

app.get<{ Querystring: { q?: string } }>("/api/youtube/search", async (request, reply) => {
  try {
    const query = normalizeSearchQuery(request.query.q);

    if (!query) {
      return reply.code(400).send({ message: "请输入要搜索的歌曲名。" });
    }

    const user = await getRequestUser(request);
    if (user) {
      const localSongs = await prisma.song.findMany({
        where: {
          userId: user.id,
          OR: [
            { title: { contains: query } },
            { artist: { contains: query } },
          ],
        },
        orderBy: { updatedAt: "desc" },
        take: 10,
      });

      const availableLocalSongs = await pruneMissingSongFiles(localSongs);

      if (availableLocalSongs.length > 0) {
        return {
          results: availableLocalSongs.map(buildLocalSongSearchResult),
          source: "local-library",
        };
      }
    }

    const apiKey = process.env.YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY;

    if (!apiKey) {
      try {
        return { results: await searchYouTubePage(query), source: "youtube-page" };
      } catch (error) {
        request.log.error(error);
        return reply.code(502).send({
          message: "YouTube 搜索暂时不可用。配置 YOUTUBE_API_KEY 后可使用官方搜索接口。",
          source: "youtube-page",
        });
      }
    }

    const params = new URLSearchParams({
      part: "snippet",
      type: "video",
      videoCategoryId: "10",
      maxResults: String(YOUTUBE_SEARCH_LIMIT),
      q: `${query} song`,
      key: apiKey,
    });

    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);
    const data = (await response.json().catch(() => null)) as YouTubeSearchResponse & { error?: { message?: string } } | null;

    if (!response.ok) {
      return reply.code(response.status >= 500 ? 502 : response.status).send({
        message: data?.error?.message || "YouTube 搜索暂时不可用。",
        source: "youtube-data-api",
      });
    }

    const results = (data?.items ?? [])
      .map((item) => {
        const videoId = item.id?.videoId;
        const snippet = item.snippet;

        if (!videoId || !snippet?.title) {
          return null;
        }

        return {
          id: videoId,
          title: snippet.title,
          channelTitle: snippet.channelTitle ?? "YouTube",
          description: snippet.description ?? "",
          publishedAt: snippet.publishedAt,
          thumbnailUrl:
            snippet.thumbnails?.high?.url ||
            snippet.thumbnails?.medium?.url ||
            snippet.thumbnails?.default?.url,
          url: `https://www.youtube.com/watch?v=${videoId}`,
        };
      })
      .filter(Boolean);

    return { results, source: "youtube-data-api" };
  } catch (error) {
    request.log.error(error);
    try {
      const fallbackQuery = normalizeSearchQuery(request.query.q);
      return { results: await searchYouTubePage(fallbackQuery), source: "youtube-page" };
    } catch (fallbackError) {
      request.log.error(fallbackError);
      return reply.code(502).send({
        message: "连接 YouTube 搜索失败，请稍后再试。",
        source: "youtube-page",
      });
    }
  }
});

app.post<{ Body: YouTubeDownloadPayload }>("/api/youtube/download", async (request, reply) => {
  const user = await requireRequestUser(request, reply);
  if (!user) {
    return;
  }
  const videoId = normalizeYouTubeVideoId(request.body.videoId);

  if (!videoId) {
    return reply.code(400).send({ message: "videoId is required" });
  }

  const existingSong = await prisma.song.findFirst({
    where: {
      userId: user.id,
      sourceType: "youtube",
      externalId: videoId,
    },
  });

  if (existingSong) {
    return { song: normalizeSong(existingSong), reused: true };
  }

  let downloaded:
    | {
        title: string;
        artist: string;
        duration?: number;
        audioUrl: string;
        coverUrl?: string;
        lyricsUrl: string;
        lyricsFilePath: string;
        sourceUrl: string;
      }
    | undefined;

  try {
    downloaded = await downloadYouTubeAudio({
      videoId,
      fallbackTitle: request.body.title,
      fallbackArtist: request.body.channelTitle,
      fallbackThumbnailUrl: request.body.thumbnailUrl,
    });
    const lyrics = await searchLyricsForDownloadedSong({
      title: downloaded.title,
      artist: downloaded.artist,
      duration: downloaded.duration,
      sourceUrl: downloaded.sourceUrl,
    });
    await writeFile(downloaded.lyricsFilePath, JSON.stringify(lyrics, null, 2), "utf8");

    const song = await prisma.song.create({
      data: {
        userId: user.id,
        title: downloaded.title,
        artist: downloaded.artist,
        audioUrl: downloaded.audioUrl,
        coverUrl: downloaded.coverUrl,
        lyrics: JSON.stringify(lyrics),
        lyricsUrl: downloaded.lyricsUrl,
        sourceType: "youtube",
        sourceUrl: downloaded.sourceUrl,
        externalId: videoId,
      },
    });

    return reply.code(201).send({ song: normalizeSong(song), reused: false });
  } catch (error) {
    await removeUploadUrl(downloaded?.audioUrl);
    await removeUploadUrl(downloaded?.coverUrl);
    await removeUploadUrl(downloaded?.lyricsUrl);
    request.log.error(error);
    return reply.code(502).send({
      message: error instanceof Error ? `下载 YouTube 音频失败：${error.message}` : "下载 YouTube 音频失败。",
    });
  }
});

app.get("/api/word-lookups", async (request, reply) => {
  const user = await requireRequestUser(request, reply);
  if (!user) {
    return;
  }
  const words = await prisma.userWordLookup.findMany({
    where: { userId: user.id },
    orderBy: [
      { lookupCount: "desc" },
      { lastLookedUpAt: "desc" },
    ],
  });

  return {
    words: words.map((item) => ({
      word: item.word,
      phonetic: item.usPhonetic || item.phonetic || undefined,
      usPhonetic: item.usPhonetic || undefined,
      ukPhonetic: item.ukPhonetic || undefined,
      partOfSpeech: item.partOfSpeech || undefined,
      meaning: item.meaning,
      lookupCount: item.lookupCount,
      lastLookedUpAt: item.lastLookedUpAt.toISOString(),
    })),
  };
});

app.get<{ Params: { word: string } }>("/api/dictionary/:word", async (request, reply) => {
  const user = await getRequestUser(request);
  const word = normalizeDictionaryWord(request.params.word);

  if (!word) {
    return reply.code(400).send({ message: "word is required" });
  }

  const localEntry = localDictionary.get(word);
  if (localEntry) {
    const onlineEntry = await lookupDictionaryApi(word).catch(() => null);
    const result: DictionaryLookupResult = {
      ...localEntry,
      phonetic: onlineEntry?.phonetic || localEntry.phonetic,
      usPhonetic: onlineEntry?.usPhonetic || localEntry.phonetic,
      ukPhonetic: onlineEntry?.ukPhonetic || onlineEntry?.phonetic || localEntry.phonetic,
      partOfSpeech: localEntry.partOfSpeech || onlineEntry?.partOfSpeech,
      example: localEntry.example || onlineEntry?.example,
      source: onlineEntry ? "ECDICT local dictionary + Free Dictionary API phonetics" : localEntry.source,
      pronunciation: {
        engine: "科大讯飞在线语音合成 TTS",
        lang: "en-US",
        accent: "American English",
      },
    };

    if (user) {
      await recordWordLookup(user.id, result);
    }
    return result;
  }

  try {
    const onlineEntry = await lookupDictionaryApi(word);
    const result: DictionaryLookupResult = {
      word: onlineEntry.word ?? word,
      phonetic: onlineEntry.phonetic,
      usPhonetic: onlineEntry.usPhonetic,
      ukPhonetic: onlineEntry.ukPhonetic,
      partOfSpeech: onlineEntry.partOfSpeech,
      meaning: onlineEntry.meaning ?? "No definition found.",
      enMeaning: onlineEntry.enMeaning,
      example: onlineEntry.example,
      source: onlineEntry.source || "Free Dictionary API",
      pronunciation: {
        engine: "科大讯飞在线语音合成 TTS",
        lang: "en-US",
        accent: "American English",
      },
    };

    if (user) {
      await recordWordLookup(user.id, result);
    }
    return result;
  } catch {
    const fallback = fallbackDictionary[word];

    if (!fallback) {
      return reply.code(404).send({
        message: "暂时没有查到这个单词。",
      });
    }

    const result: DictionaryLookupResult = {
      word,
      ...fallback,
      usPhonetic: fallback.phonetic,
      ukPhonetic: fallback.phonetic,
      source: "Local fallback dictionary",
      pronunciation: {
        engine: "科大讯飞在线语音合成 TTS",
        lang: "en-US",
        accent: "American English",
      },
    };

    if (user) {
      await recordWordLookup(user.id, result);
    }
    return result;
  }
});

app.post<{ Body: TtsPayload }>("/api/tts", async (request, reply) => {
  const text = normalizeTtsText(request.body.text);

  if (!text) {
    return reply.code(400).send({ message: "text is required" });
  }

  if (!process.env.XF_APPID || !process.env.XF_API_KEY || !process.env.XF_API_SECRET) {
    return reply.code(503).send({
      message: "讯飞 TTS 环境变量未配置。",
    });
  }

  const lang = request.body.lang === "en-GB" ? "en-GB" : "en-US";
  const voice = getTtsVoice({ ...request.body, lang });
  const speed = clampNumber(request.body.speed, Number(process.env.XF_TTS_SPEED ?? 42));
  const volume = clampNumber(request.body.volume, Number(process.env.XF_TTS_VOLUME ?? 85));
  const pitch = clampNumber(request.body.pitch, Number(process.env.XF_TTS_PITCH ?? 50));
  const logicalCacheKey = `tts:${lang}:${voice}:${normalizeTtsCacheText(text)}:${speed}:${volume}:${pitch}`;
  const cacheKey = createHash("sha256")
    .update(logicalCacheKey)
    .digest("hex");
  const fileName = `${cacheKey}.mp3`;
  const filePath = path.join(ttsRoot, fileName);
  const audioUrl = `/uploads/tts/${fileName}`;

  if (await fileExists(filePath)) {
    return {
      url: audioUrl,
      cached: true,
      cacheKey: logicalCacheKey,
      engine: "xfyun-online-tts",
      lang,
      voice,
    };
  }

  try {
    const audio = await synthesizeWithXfYun({ text, voice, speed, volume, pitch });
    await writeFile(filePath, audio);

    return reply.code(201).send({
      url: audioUrl,
      cached: false,
      cacheKey: logicalCacheKey,
      engine: "xfyun-online-tts",
      lang,
      voice,
    });
  } catch (error) {
    request.log.error(error);
    return reply.code(502).send({
      message: error instanceof Error ? error.message : "讯飞 TTS 调用失败。",
    });
  }
});

app.post("/api/songs", async (request, reply) => {
  try {
    const user = await requireRequestUser(request, reply);
    if (!user) {
      return;
    }
    const parts = request.parts();
    const fields: Record<string, string> = {};
    const files: Record<string, { url: string; filename: string }> = {};

    for await (const part of parts) {
      if (part.type === "field") {
        fields[part.fieldname] = String(part.value ?? "");
        continue;
      }

      const fileName = `${Date.now()}-${sanitizeFileName(part.filename)}`;
      const filePath = path.join(uploadRoot, fileName);
      await pipeline(part.file, createWriteStream(filePath));
      files[part.fieldname] = {
        filename: part.filename,
        url: `/uploads/${fileName}`,
      };
    }

    const title = fields.title?.trim();
    const artist = fields.artist?.trim() || "Local Artist";
    const lyrics = fields.lyrics?.trim();

    if (!title || !files.audio || !lyrics) {
      return reply.code(400).send({
        message: "需要歌曲名称、音频文件和歌词文件。",
      });
    }

    const song = await prisma.song.create({
      data: {
        userId: user.id,
        title,
        artist,
        audioUrl: files.audio.url,
        coverUrl: files.cover?.url,
        lyrics,
        sourceType: "upload",
      },
    });

    return reply.code(201).send({ song: normalizeSong(song) });
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({
      message: error instanceof Error ? error.message : "上传歌曲失败。",
    });
  }
});

app.patch<{ Params: { id: string }; Body: SongLyricsPayload }>("/api/songs/:id/lyrics", async (request, reply) => {
  const user = await requireRequestUser(request, reply);
  if (!user) {
    return;
  }
  const lyrics = normalizeLyricsPayload(request.body.lyrics);

  const existingSong = await prisma.song.findFirst({
    where: {
      id: request.params.id,
      userId: user.id,
    },
  });

  if (!existingSong) {
    return reply.code(404).send({ message: "歌曲不存在或无权修改。" });
  }

  const song = await prisma.song.update({
    where: { id: existingSong.id },
    data: {
      lyrics: JSON.stringify(lyrics),
    },
  });
  await writeSongLyricsFile(song.lyricsUrl, lyrics);

  return { song: normalizeSong(song) };
});

app.get("/api/favorites", async (request, reply) => {
  const user = await requireRequestUser(request, reply);
  if (!user) {
    return;
  }
  const favorites = await prisma.userFavoriteSong.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return { songs: favorites.map(normalizeFavoriteSong) };
});

app.post<{ Body: FavoriteSongPayload }>("/api/favorites", async (request, reply) => {
  const user = await requireRequestUser(request, reply);
  if (!user) {
    return;
  }
  const title = request.body.title?.trim();
  const artist = request.body.artist?.trim() || "Unknown Artist";

  if (!title) {
    return reply.code(400).send({ message: "title is required" });
  }

  const favoriteKey = getFavoriteKey({
    id: request.body.id,
    title,
    artist,
  });

  const favorite = await prisma.userFavoriteSong.upsert({
    where: {
      userId_favoriteKey: {
        userId: user.id,
        favoriteKey,
      },
    },
    update: {
      songId: request.body.id,
      title,
      artist,
      audioUrl: request.body.audioUrl?.trim(),
      coverUrl: request.body.coverUrl?.trim(),
      lyrics: request.body.lyrics ? JSON.stringify(request.body.lyrics) : undefined,
    },
    create: {
      userId: user.id,
      songId: request.body.id,
      favoriteKey,
      title,
      artist,
      audioUrl: request.body.audioUrl?.trim(),
      coverUrl: request.body.coverUrl?.trim(),
      lyrics: request.body.lyrics ? JSON.stringify(request.body.lyrics) : undefined,
    },
  });

  return reply.code(201).send({ song: normalizeFavoriteSong(favorite) });
});

app.delete<{ Params: { favoriteKey: string } }>("/api/favorites/:favoriteKey", async (request, reply) => {
  const user = await requireRequestUser(request, reply);
  if (!user) {
    return;
  }
  const favoriteKey = decodeURIComponent(request.params.favoriteKey);

  await prisma.userFavoriteSong.deleteMany({
    where: {
      userId: user.id,
      favoriteKey,
    },
  });

  return reply.code(204).send();
});

app.post<{ Body: VocabularyPayload }>("/api/vocabulary", async (request, reply) => {
  const user = await requireRequestUser(request, reply);
  if (!user) {
    return;
  }
  const word = request.body.word?.trim().toLowerCase();
  const meaning = request.body.meaning?.trim();
  const sourceTimeValue = Number(request.body.sourceTime);
  const sourceTime = Number.isFinite(sourceTimeValue) ? sourceTimeValue : undefined;

  if (!word || !meaning) {
    return reply.code(400).send({
      message: "word and meaning are required",
    });
  }

  const savedWord = await prisma.vocabularyWord.upsert({
    where: {
      userId_word: {
        userId: user.id,
        word,
      },
    },
    update: {
      phonetic: request.body.phonetic?.trim(),
      meaning,
      example: request.body.example?.trim(),
      sourceSong: request.body.sourceSong?.trim(),
      sourceSongId: request.body.sourceSongId?.trim(),
      sourceTime,
      sourceLine: request.body.sourceLine?.trim(),
    },
    create: {
      userId: user.id,
      word,
      phonetic: request.body.phonetic?.trim(),
      meaning,
      example: request.body.example?.trim(),
      sourceSong: request.body.sourceSong?.trim(),
      sourceSongId: request.body.sourceSongId?.trim(),
      sourceTime,
      sourceLine: request.body.sourceLine?.trim(),
    },
  });

  return reply.code(201).send({ word: savedWord });
});

app.delete<{ Params: { word: string } }>("/api/vocabulary/:word", async (request, reply) => {
  const user = await requireRequestUser(request, reply);
  if (!user) {
    return;
  }
  const word = request.params.word.trim().toLowerCase();

  await prisma.vocabularyWord.deleteMany({
    where: { userId: user.id, word },
  });

  return reply.code(204).send();
});

const port = Number(process.env.API_PORT ?? 8787);

try {
  await app.listen({ port, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  await prisma.$disconnect();
  process.exit(1);
}

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
