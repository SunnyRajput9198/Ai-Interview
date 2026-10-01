import { prisma, Prisma } from "./db";
import { createEmbeddings } from "./ai-client";
import { z } from "zod";
import type { InterviewType, KnowledgeSourceType } from "./types";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RetrievedChunk {
  documentId: string;
  documentName: string;
  chunkIndex: number;
  content: string;
}

export const RetrievedChunksSchema = z.array(
  z.object({
    documentId: z.string(),
    documentName: z.string(),
    chunkIndex: z.number(),
    content: z.string(),
  }),
);

function vectorToSql(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

// ── Raw query result type (pgvector returns rows as objects) ──────────────────

type ChunkRow = {
  id: string;
  documentId: string;
  documentName: string;
  chunkIndex: number | bigint;
  content: string;
};

function mapRows(rows: ChunkRow[]): RetrievedChunk[] {
  return rows.map((r) => ({
    documentId: r.documentId,
    documentName: r.documentName,
    chunkIndex: Number(r.chunkIndex),
    content: r.content,
  }));
}

async function retrieveChunks(options: {
  query: string;
  topK: number;
  projectId?: string;
  sourceTypes?: KnowledgeSourceType[];
}): Promise<RetrievedChunk[]> {
  const [embedding] = await createEmbeddings([options.query]);
  if (!embedding) throw new Error("Embedding service returned no vector");
  const vector = vectorToSql(embedding);
  const sourceFilter = options.sourceTypes
    ? options.sourceTypes.length === 0
      ? null
      : Prisma.sql`AND d."knowledgeSourceType" IN (${Prisma.join(options.sourceTypes)})`
    : Prisma.empty;
  if (sourceFilter === null) return [];

  const projectFilter = options.projectId
    ? Prisma.sql`AND d."projectId" = ${options.projectId}`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<ChunkRow[]>(Prisma.sql`
    SELECT
      dc.id,
      dc."documentId",
      d.name AS "documentName",
      dc."chunkIndex",
      dc.content
    FROM "DocumentChunk" dc
    JOIN "Document" d ON dc."documentId" = d.id
    WHERE d."processingStatus" = 'PROCESSED'
      AND dc.embedding IS NOT NULL
      ${projectFilter}
      ${sourceFilter}
    ORDER BY dc.embedding <=> ${vector}::vector ASC
    LIMIT ${options.topK}
  `);

  return mapRows(rows);
}

// ── retrieveForProject ────────────────────────────────────────────────────────

export async function retrieveForProject(
  projectId: string,
  query: string,
  topK = 5,
): Promise<RetrievedChunk[]> {
  return retrieveChunks({ projectId, query, topK });
}

// ── retrieveForTopic ──────────────────────────────────────────────────────────

export async function retrieveForTopic(
  sourceTypes: KnowledgeSourceType[],
  query: string,
  topK = 5,
): Promise<RetrievedChunk[]> {
  return retrieveChunks({ sourceTypes, query, topK });
}

// ── retrieveForInterview ──────────────────────────────────────────────────────

export async function retrieveForInterview(
  interviewId: string,
  query: string,
  topK = 8,
): Promise<RetrievedChunk[]> {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
  });

  if (!interview) return [];

  return retrieveForQuestion({
    interviewType: interview.interviewType as InterviewType,
    projectId: interview.projectId ?? undefined,
    questionText: query,
    topK,
  });
}

// ── retrieveForQuestion ───────────────────────────────────────────────────────

export async function retrieveForQuestion(context: {
  interviewType: InterviewType;
  projectId?: string;
  questionText: string;
  topK?: number;
}): Promise<RetrievedChunk[]> {
  const { interviewType, projectId, questionText, topK = 8 } = context;

  // PROJECT: use project documents (all types)
  if (
    ["PROJECT", "SYSTEM_DESIGN", "AI_ML", "MIXED"].includes(interviewType) &&
    projectId
  ) {
    return retrieveForProject(projectId, questionText, topK);
  }

  // TECHNICAL: technical notes, resume, architecture, project docs
  if (
    ["TECHNICAL", "AI_ML", "MIXED", "SYSTEM_DESIGN"].includes(interviewType)
  ) {
    const types: KnowledgeSourceType[] = [
      "TECHNICAL_NOTES",
      "RESUME",
      "ARCHITECTURE",
      "PROJECT",
    ];
    // If there's a project, also include its docs
    if (projectId) {
      const projectChunks = await retrieveForProject(
        projectId,
        questionText,
        Math.ceil(topK / 2),
      );
      const topicChunks = await retrieveForTopic(
        types,
        questionText,
        Math.floor(topK / 2),
      );
      // Deduplicate by documentId+chunkIndex
      const seen = new Set<string>();
      return [...projectChunks, ...topicChunks].filter((c) => {
        const key = `${c.documentId}:${c.chunkIndex}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    return retrieveForTopic(types, questionText, topK);
  }

  // HR: resume, project overview, interview prep
  if (interviewType === "HR") {
    const types: KnowledgeSourceType[] = [
      "RESUME",
      "PROJECT",
      "INTERVIEW_PREPARATION",
    ];
    return retrieveForTopic(types, questionText, topK);
  }

  // FULL: search everything (no type filter)
  return retrieveForFull(questionText, topK);
}

// ── retrieveForFull (no filter) ───────────────────────────────────────────────

async function retrieveForFull(
  query: string,
  topK = 8,
): Promise<RetrievedChunk[]> {
  return retrieveChunks({ query, topK });
}
