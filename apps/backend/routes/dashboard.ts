import { Router } from "express";
import { prisma } from "../db";

const router = Router();

// GET /api/dashboard
router.get("/", async (_req, res) => {
  const [projectCount, documentCount, processedCount, recentProjects, recentGeneralDocs] =
    await Promise.all([
      prisma.project.count(),
      prisma.document.count(),
      prisma.document.count({ where: { processingStatus: "PROCESSED" } }),
      prisma.project.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { documents: true } } },
      }),
      prisma.document.findMany({
        take: 5,
        where: { projectId: null },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          knowledgeSourceType: true,
          processingStatus: true,
          fileSize: true,
          createdAt: true,
        },
      }),
    ]);

  res.json({
    projectCount,
    documentCount,
    processedCount,
    recentProjects: recentProjects.map((p) => ({
      id: p.id,
      name: p.name,
      technologies: p.technologies,
      documentCount: p._count.documents,
      createdAt: p.createdAt,
    })),
    recentGeneralDocs,
  });
});

export default router;
