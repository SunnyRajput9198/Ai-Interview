import { Router } from "express";
import { prisma, Prisma } from "../db";
import { processDocument } from "../processing-pipeline";
import { handleDocumentUpload } from "../document-upload";
import { KnowledgeSourceTypeSchema } from "../types";

const router = Router();

// POST /api/documents
router.post("/", handleDocumentUpload, async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const { knowledgeSourceType, projectId, description } = req.body as {
    knowledgeSourceType?: string;
    projectId?: string;
    description?: string;
  };

  const sourceType = KnowledgeSourceTypeSchema.safeParse(knowledgeSourceType);
  if (!sourceType.success) {
    res.status(400).json({ error: "A valid knowledgeSourceType is required" });
    return;
  }

  // Validate projectId if provided
  if (projectId) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
  }

  const doc = await prisma.document.create({
    data: {
      projectId: projectId ?? null,
      knowledgeSourceType: sourceType.data,
      name: req.file.originalname,
      description: description?.trim() ?? null,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      storagePath: req.file.path,
      processingStatus: "UPLOADED",
    },
  });

  // Fire-and-forget
  processDocument(doc.id).catch(console.error);

  res.status(201).json({ id: doc.id });
});

// GET /api/documents
router.get("/", async (_req, res) => {
  const documents = await prisma.document.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      description: true,
      knowledgeSourceType: true,
      processingStatus: true,
      fileSize: true,
      mimeType: true,
      projectId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  res.json(documents);
});

// GET /api/documents/:id
router.get("/:id", async (req, res) => {
  const doc = await prisma.document.findUnique({
    where: { id: req.params.id },
    include: {
      chunks: {
        select: {
          id: true,
          chunkIndex: true,
          content: true,
          metadata: true,
          createdAt: true,
          // embedding deliberately excluded
        },
        orderBy: { chunkIndex: "asc" },
      },
    },
  });

  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  res.json(doc);
});

// DELETE /api/documents/:id
router.delete("/:id", async (req, res) => {
  const doc = await prisma.document.findUnique({
    where: { id: req.params.id },
  });
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  // Delete chunks first (cascade handles it, but be explicit)
  await prisma.documentChunk.deleteMany({
    where: { documentId: req.params.id },
  });
  await prisma.document.delete({ where: { id: req.params.id } });

  // Delete file from disk
  try {
    const file = Bun.file(doc.storagePath);
    if (await file.exists()) {
      await Bun.file(doc.storagePath).delete?.();
      // Fallback: use unlink if Bun.file doesn't have .delete
      const { unlink } = await import("node:fs/promises");
      await unlink(doc.storagePath).catch(() => {});
    }
  } catch {
    // File deletion failure is non-fatal
  }

  res.status(204).send();
});

// POST /api/documents/:id/reprocess
router.post("/:id/reprocess", async (req, res) => {
  const doc = await prisma.document.findUnique({
    where: { id: req.params.id },
  });
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  if (doc.processingStatus !== "FAILED") {
    res.status(400).json({
      error: `Document cannot be reprocessed. Current status: ${doc.processingStatus}. Only FAILED documents can be reprocessed.`,
    });
    return;
  }

  await prisma.document.update({
    where: { id: req.params.id },
    data: { processingStatus: "UPLOADED" as const, metadata: Prisma.JsonNull },
  });

  // Fire-and-forget
  processDocument(req.params.id).catch(console.error);

  res.json({ message: "Reprocessing started", id: req.params.id });
});

export default router;
