import { prisma } from "./db";
import { createEmbeddings } from "./ai-client";
import { DOCUMENT_CHUNK_OVERLAP, DOCUMENT_CHUNK_SIZE } from "./config";

// ── Text extraction ───────────────────────────────────────────────────────────

export async function extractText(
  filePath: string,
  mimeType: string,
): Promise<string> {
  if (mimeType === "text/plain" || mimeType === "text/markdown") {
    return await Bun.file(filePath).text();
  }

  if (mimeType === "application/pdf") {
    const pdfParse = (await import("pdf-parse")).default;
    const buffer = await Bun.file(filePath).arrayBuffer();
    const data = await pdfParse(Buffer.from(buffer));
    return data.text;
  }

  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const mammoth = await import("mammoth");
    const buffer = await Bun.file(filePath).arrayBuffer();
    const result = await mammoth.extractRawText({
      buffer: Buffer.from(buffer),
    });
    return result.value;
  }

  throw new Error(`Unsupported MIME type for text extraction: ${mimeType}`);
}

// ── Chunking ──────────────────────────────────────────────────────────────────

export function chunkText(
  text: string,
  chunkSize = DOCUMENT_CHUNK_SIZE,
  overlap = DOCUMENT_CHUNK_OVERLAP,
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const chunks: string[] = [];
  let i = 0;
  while (i < trimmed.length) {
    const end = Math.min(i + chunkSize, trimmed.length);
    chunks.push(trimmed.slice(i, end));
    if (end === trimmed.length) break;
    i += chunkSize - overlap;
  }

  // Guarantee at least one chunk for any non-empty text
  if (chunks.length === 0 && trimmed.length > 0) {
    chunks.push(trimmed);
  }

  return chunks;
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function processDocument(documentId: string): Promise<void> {
  try {
    // Set status to PROCESSING
    await prisma.document.update({
      where: { id: documentId },
      data: { processingStatus: "PROCESSING" },
    });

    const doc = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!doc) throw new Error("Document not found");

    // 1. Extract text
    const rawText = await extractText(doc.storagePath, doc.mimeType);

    // 2. Chunk
    const chunks = chunkText(rawText);

    // 3. Embed
    const embeddings = await createEmbeddings(chunks);

    // 4. Delete existing chunks (idempotent reprocessing)
    await prisma.documentChunk.deleteMany({ where: { documentId } });

    // 5. Insert new chunks with embeddings via raw SQL (pgvector)
    for (let i = 0; i < chunks.length; i++) {
      const chunkId = crypto.randomUUID();
      const vectorStr = `[${embeddings[i]!.join(",")}]`;

      // Insert the chunk row first
      await prisma.$executeRaw`
        INSERT INTO "DocumentChunk" (id, "documentId", "chunkIndex", content, embedding, "createdAt")
        VALUES (
          ${chunkId},
          ${documentId},
          ${i},
          ${chunks[i]!},
          ${vectorStr}::vector,
          NOW()
        )
      `;
    }

    // 6. Mark as PROCESSED
    await prisma.document.update({
      where: { id: documentId },
      data: { processingStatus: "PROCESSED" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.document.update({
      where: { id: documentId },
      data: {
        processingStatus: "FAILED",
        metadata: { error: message },
      },
    });
    console.error(
      `[processing-pipeline] Failed to process ${documentId}:`,
      err,
    );
  }
}
