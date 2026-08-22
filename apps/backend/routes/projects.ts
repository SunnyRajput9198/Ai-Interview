import { Router } from "express";
import multer from "multer";
import path from "path";
import { prisma } from "../db";
import { processDocument } from "../processing-pipeline";

const router = Router();

// Multer config shared with documents route
const maxSizeMB = parseInt(process.env.MAX_DOCUMENT_SIZE_MB ?? "20", 10);
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, "uploads/"),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${crypto.randomUUID()}`;
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: maxSizeMB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported file type. Allowed: pdf, txt, md, docx"));
    }
  },
});

// POST /api/projects
router.post("/", async (req, res) => {
  const { name, description, technologies } = req.body as {
    name?: string;
    description?: string;
    technologies?: string[];
  };

  if (!name?.trim()) {
    res.status(400).json({ error: "Project name is required" });
    return;
  }

  const project = await prisma.project.create({
    data: {
      name: name.trim(),
      description: description?.trim() ?? null,
      technologies: technologies ?? [],
    },
  });

  res.status(201).json(project);
});

// GET /api/projects
router.get("/", async (_req, res) => {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { documents: true } },
    },
  });

  res.json(
    projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      technologies: p.technologies,
      documentCount: p._count.documents,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }))
  );
});

// GET /api/projects/:id
router.get("/:id", async (req, res) => {
  const projectId = req.params["id"] as string;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      documents: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          description: true,
          knowledgeSourceType: true,
          processingStatus: true,
          fileSize: true,
          mimeType: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.json(project);
});

// PATCH /api/projects/:id
router.patch("/:id", async (req, res) => {
  const pid = req.params["id"] as string;
  const existing = await prisma.project.findUnique({ where: { id: pid } });
  if (!existing) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const { name, description, technologies } = req.body as {
    name?: string;
    description?: string;
    technologies?: string[];
  };

  const updated = await prisma.project.update({
    where: { id: pid },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(description !== undefined && { description: description.trim() }),
      ...(technologies !== undefined && { technologies }),
    },
  });

  res.json(updated);
});

// DELETE /api/projects/:id
router.delete("/:id", async (req, res) => {
  const pid = req.params["id"] as string;
  const existing = await prisma.project.findUnique({ where: { id: pid } });
  if (!existing) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  // Cascade is handled by Prisma schema (onDelete: Cascade)
  await prisma.project.delete({ where: { id: pid } });
  res.status(204).send();
});

// GET /api/projects/:id/documents
router.get("/:id/documents", async (req, res) => {
  const pid = req.params["id"] as string;
  const project = await prisma.project.findUnique({ where: { id: pid } });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const documents = await prisma.document.findMany({
    where: { projectId: pid },
    orderBy: { createdAt: "desc" },
  });

  res.json(documents);
});

// POST /api/projects/:id/documents
router.post("/:id/documents", upload.single("file"), async (req, res) => {
  const pid = req.params["id"] as string;
  const project = await prisma.project.findUnique({ where: { id: pid } });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const { knowledgeSourceType, description } = req.body as {
    knowledgeSourceType?: string;
    description?: string;
  };

  if (!knowledgeSourceType) {
    res.status(400).json({ error: "knowledgeSourceType is required" });
    return;
  }

  const doc = await prisma.document.create({
    data: {
      projectId: pid,
      knowledgeSourceType: knowledgeSourceType as any,
      name: req.file.originalname,
      description: description?.trim() ?? null,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      storagePath: req.file.path,
      processingStatus: "UPLOADED",
    },
  });

  // Fire-and-forget — never await in request handler
  processDocument(doc.id).catch(console.error);

  res.status(201).json({ id: doc.id });
});

export default router;
