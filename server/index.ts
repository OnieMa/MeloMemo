import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { config } from "dotenv";
import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

config({ path: ".env.local" });
config();

const prisma = new PrismaClient();
const app = Fastify({
  logger: true,
});
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const uploadRoot = path.join(projectRoot, "server", "uploads");
const ttsRoot = path.join(uploadRoot, "tts");
const dictionaryRoot = path.join(projectRoot, "server", "dictionaries");
const ecdictCsvPath = path.join(dictionaryRoot, "ecdict.csv");
const DEFAULT_USER_EMAIL = "demo@melomemo.local";
const DEFAULT_USER_PASSWORD = "melomemo-demo";

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

type FavoriteSongPayload = {
  id?: string;
  title?: string;
  artist?: string;
  audioUrl?: string;
  coverUrl?: string;
  lyrics?: Array<{ id: string; time: number; text: string }>;
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
await mkdir(dictionaryRoot, { recursive: true });
await app.register(fastifyStatic, {
  root: uploadRoot,
  prefix: "/uploads/",
});

app.get("/api/health", async () => ({ ok: true }));

const getFavoriteKey = (song: { id?: string | null; title: string; artist: string }) =>
  song.id ? `id:${song.id}` : `song:${song.title.trim().toLowerCase()}::${song.artist.trim().toLowerCase()}`;

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

const ensureUserProfile = async (userId: string) =>
  prisma.userProfile.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      cumulativeDays: 128,
      masteredWords: 1450,
      conqueredSentences: 320,
    },
  });

const ensureDefaultUser = async () => {
  const user = await prisma.user.upsert({
    where: { email: DEFAULT_USER_EMAIL },
    update: {},
    create: {
      email: DEFAULT_USER_EMAIL,
      passwordHash: hashPassword(DEFAULT_USER_PASSWORD),
      displayName: "音律旅人",
      avatarUrl:
        "https://lh3.googleusercontent.com/aida-public/AB6AXuBUysvjdILh1cXFtHAS32MsdeoPUxMUQui-iBosnBkTcRUVWczqZBdf4NjfRqwB-oKLn7iXPkERDhTXs4BkURjp-NBtVQxBvSDzGXuiPLUdWNMo37HDg6LQcDtr41Zk2CF73lUXrvLrCzsQvPZk8V6O2Kpgf9hq4FNVCkdtttae7ZW0Q0l3VsZDPKh-zvmv8O6nycuhNQ1jsEVPC8BAUPPwQ2ZwjB6SsDg-bQxyEVX6_5l-IfJpCmpPlqbu-_F2b5mGyQ8rDEHAu3Pb",
    },
  });
  await ensureUserProfile(user.id);
  return user;
};

const getRequestUser = async (request: { headers: Record<string, string | string[] | undefined> }) => {
  const userIdHeader = request.headers["x-user-id"];
  const userId = Array.isArray(userIdHeader) ? userIdHeader[0] : userIdHeader;

  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user) {
      await ensureUserProfile(user.id);
      return user;
    }
  }

  return ensureDefaultUser();
};

const sanitizeFileName = (value: string) =>
  value
    .replace(/[^\w.\-\u4e00-\u9fa5]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "file";

const normalizeTtsText = (value?: string) =>
  (value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

const normalizeTtsCacheText = (value: string) => value.toLocaleLowerCase("en-US");

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
  createdAt: Date;
  updatedAt: Date;
}) => ({
  ...song,
  coverUrl: song.coverUrl ?? undefined,
  lyrics: JSON.parse(song.lyrics),
});

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

  if (!email || password.length < 6) {
    return reply.code(400).send({ message: "email and a 6+ character password are required" });
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: { displayName },
    create: {
      email,
      passwordHash: hashPassword(password),
      displayName,
    },
  });
  await ensureUserProfile(user.id);

  return reply.code(201).send({ user: publicUser(user) });
});

app.post<{ Body: AuthPayload }>("/api/auth/login", async (request, reply) => {
  const email = request.body.email?.trim().toLowerCase();
  const password = request.body.password ?? "";

  if (!email || !password) {
    return reply.code(400).send({ message: "email and password are required" });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return reply.code(401).send({ message: "邮箱或密码不正确。" });
  }

  await ensureUserProfile(user.id);
  return { user: publicUser(user) };
});

app.get("/api/auth/me", async (request) => {
  const user = await getRequestUser(request);
  return { user: publicUser(user) };
});

app.get("/api/profile", async (request) => {
  const user = await getRequestUser(request);
  const profile = await ensureUserProfile(user.id);
  const favoriteSongCount = await prisma.userFavoriteSong.count({
    where: { userId: user.id },
  });
  const masteredWords = await prisma.vocabularyWord.count({
    where: { userId: user.id },
  });

  return {
    user: publicUser(user),
    stats: {
      cumulativeDays: profile.cumulativeDays,
      masteredWords: Math.max(profile.masteredWords, masteredWords),
      conqueredSentences: profile.conqueredSentences,
      favoriteSongs: favoriteSongCount,
    },
  };
});

app.patch<{ Body: ProfilePayload }>("/api/profile", async (request) => {
  const user = await getRequestUser(request);
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
        cumulativeDays: profileUpdate.cumulativeDays ?? 128,
        masteredWords: profileUpdate.masteredWords ?? 1450,
        conqueredSentences: profileUpdate.conqueredSentences ?? 320,
      },
    }),
  ]);
  const favoriteSongCount = await prisma.userFavoriteSong.count({
    where: { userId: user.id },
  });

  return {
    user: publicUser(updatedUser),
    stats: {
      cumulativeDays: profile.cumulativeDays,
      masteredWords: profile.masteredWords,
      conqueredSentences: profile.conqueredSentences,
      favoriteSongs: favoriteSongCount,
    },
  };
});

app.get("/api/vocabulary", async (request) => {
  const user = await getRequestUser(request);
  const words = await prisma.vocabularyWord.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return { words };
});

app.get("/api/songs", async (request) => {
  const user = await getRequestUser(request);
  const songs = await prisma.song.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return { songs: songs.map(normalizeSong) };
});

app.get<{ Params: { word: string } }>("/api/dictionary/:word", async (request, reply) => {
  const word = normalizeDictionaryWord(request.params.word);

  if (!word) {
    return reply.code(400).send({ message: "word is required" });
  }

  const localEntry = localDictionary.get(word);
  if (localEntry) {
    const onlineEntry = await lookupDictionaryApi(word).catch(() => null);

    return {
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
  }

  try {
    const onlineEntry = await lookupDictionaryApi(word);

    return {
      word: onlineEntry.word ?? word,
      phonetic: onlineEntry.phonetic,
      usPhonetic: onlineEntry.usPhonetic,
      ukPhonetic: onlineEntry.ukPhonetic,
      partOfSpeech: onlineEntry.partOfSpeech,
      meaning: onlineEntry.meaning ?? "No definition found.",
      enMeaning: onlineEntry.enMeaning,
      example: onlineEntry.example,
      source: onlineEntry.source,
      pronunciation: {
        engine: "科大讯飞在线语音合成 TTS",
        lang: "en-US",
        accent: "American English",
      },
    };
  } catch {
    const fallback = fallbackDictionary[word];

    if (!fallback) {
      return reply.code(404).send({
        message: "暂时没有查到这个单词。",
      });
    }

    return {
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
    const user = await getRequestUser(request);
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

app.get("/api/favorites", async (request) => {
  const user = await getRequestUser(request);
  const favorites = await prisma.userFavoriteSong.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return { songs: favorites.map(normalizeFavoriteSong) };
});

app.post<{ Body: FavoriteSongPayload }>("/api/favorites", async (request, reply) => {
  const user = await getRequestUser(request);
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
  const user = await getRequestUser(request);
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
  const user = await getRequestUser(request);
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
  const user = await getRequestUser(request);
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
