import { prisma } from "./db";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RetrievedChunk {
  documentId: string;
  documentName: string;
  chunkIndex: number;
  content: string;
}

type KnowledgeSourceType =
  | "RESUME"
  | "PROJECT"
  | "ARCHITECTURE"
  | "TECHNICAL_NOTES"
  | "API_DOCUMENTATION"
  | "DATABASE_DOCUMENTATION"
  | "DEPLOYMENT"
  | "INTERVIEW_PREPARATION"
  | "OTHER";

type InterviewType = "TECHNICAL" | "PROJECT" | "HR" | "FULL";

// ── Internal: embed a query string ───────────────────────────────────────────

async function embedQuery(query: string): Promise<number[]> {
  const response = await fetch("https://aicredits.in/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: query,
      dimensions: 1536,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI embeddings error: ${await response.text()}`);
  }

  const json = (await response.json()) as { data: { embedding: number[] }[] };
  return json.data[0]!.embedding;
}

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

// ── retrieveForProject ────────────────────────────────────────────────────────

export async function retrieveForProject(
  projectId: string,
  query: string,
  topK = 5
): Promise<RetrievedChunk[]> {
  const embedding = await embedQuery(query);
  const vecStr = vectorToSql(embedding);

  const rows = await prisma.$queryRaw<ChunkRow[]>`
    SELECT
      dc.id,
      dc."documentId",
      d.name AS "documentName",
      dc."chunkIndex",
      dc.content
    FROM "DocumentChunk" dc
    JOIN "Document" d ON dc."documentId" = d.id
    WHERE d."projectId" = ${projectId}
      AND d."processingStatus" = 'PROCESSED'
      AND dc.embedding IS NOT NULL
    ORDER BY dc.embedding <=> ${vecStr}::vector ASC
    LIMIT ${topK}
  `;

  return mapRows(rows);
}

// ── retrieveForTopic ──────────────────────────────────────────────────────────

export async function retrieveForTopic(
  sourceTypes: KnowledgeSourceType[],
  query: string,
  topK = 5
): Promise<RetrievedChunk[]> {
  const embedding = await embedQuery(query);
  const vecStr = vectorToSql(embedding);

  // Prisma raw doesn't support array params nicely; build the IN list safely
  const typeList = sourceTypes.map((t) => `'${t}'`).join(",");

  const rows = await prisma.$queryRawUnsafe<ChunkRow[]>(`
    SELECT
      dc.id,
      dc."documentId",
      d.name AS "documentName",
      dc."chunkIndex",
      dc.content
    FROM "DocumentChunk" dc
    JOIN "Document" d ON dc."documentId" = d.id
    WHERE d."knowledgeSourceType" IN (${typeList})
      AND d."processingStatus" = 'PROCESSED'
      AND dc.embedding IS NOT NULL
    ORDER BY dc.embedding <=> '${vecStr}'::vector ASC
    LIMIT ${topK}
  `);

  return mapRows(rows);
}

// ── retrieveForInterview ──────────────────────────────────────────────────────

export async function retrieveForInterview(
  interviewId: string,
  query: string,
  topK = 8
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
  if (interviewType === "PROJECT" && projectId) {
    return retrieveForProject(projectId, questionText, topK);
  }

  // TECHNICAL: technical notes, resume, architecture, project docs
  if (interviewType === "TECHNICAL") {
    const types: KnowledgeSourceType[] = [
      "TECHNICAL_NOTES",
      "RESUME",
      "ARCHITECTURE",
      "PROJECT",
    ];
    // If there's a project, also include its docs
    if (projectId) {
      const projectChunks = await retrieveForProject(projectId, questionText, Math.ceil(topK / 2));
      const topicChunks = await retrieveForTopic(types, questionText, Math.floor(topK / 2));
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
  topK = 8
): Promise<RetrievedChunk[]> {
  const embedding = await embedQuery(query);
  const vecStr = vectorToSql(embedding);

  const rows = await prisma.$queryRaw<ChunkRow[]>`
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
    ORDER BY dc.embedding <=> ${vecStr}::vector ASC
    LIMIT ${topK}
  `;

  return mapRows(rows);
}
