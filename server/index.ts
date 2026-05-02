import cors from "@fastify/cors";
import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const app = Fastify({
  logger: true,
});

type VocabularyPayload = {
  word?: string;
  phonetic?: string;
  meaning?: string;
  example?: string;
  sourceSong?: string;
};

await app.register(cors, {
  origin: true,
});

app.get("/api/health", async () => ({ ok: true }));

app.get("/api/vocabulary", async () => {
  const words = await prisma.vocabularyWord.findMany({
    orderBy: { createdAt: "desc" },
  });

  return { words };
});

app.post<{ Body: VocabularyPayload }>("/api/vocabulary", async (request, reply) => {
  const word = request.body.word?.trim().toLowerCase();
  const meaning = request.body.meaning?.trim();

  if (!word || !meaning) {
    return reply.code(400).send({
      message: "word and meaning are required",
    });
  }

  const savedWord = await prisma.vocabularyWord.upsert({
    where: { word },
    update: {
      phonetic: request.body.phonetic?.trim(),
      meaning,
      example: request.body.example?.trim(),
      sourceSong: request.body.sourceSong?.trim(),
    },
    create: {
      word,
      phonetic: request.body.phonetic?.trim(),
      meaning,
      example: request.body.example?.trim(),
      sourceSong: request.body.sourceSong?.trim(),
    },
  });

  return reply.code(201).send({ word: savedWord });
});

app.delete<{ Params: { word: string } }>("/api/vocabulary/:word", async (request, reply) => {
  const word = request.params.word.trim().toLowerCase();

  await prisma.vocabularyWord.deleteMany({
    where: { word },
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
