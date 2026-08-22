import express from "express";
import cors from "cors";
import { prisma, Prisma } from "./db";
import { calculateResult } from "./result";
import { PreInterviewBody } from "./types";
import projectsRouter from "./routes/projects";
import documentsRouter from "./routes/documents";
import dashboardRouter from "./routes/dashboard";
import voiceRouter from "./routes/voice";

const app = express();
app.use(express.json());
app.use(cors());

// ── Knowledge / project routes ────────────────────────────────────────────────
app.use("/api/projects", projectsRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/dashboard", dashboardRouter);

// ── Voice interview routes (chunk-based: transcribe → respond → speak) ────────
app.use("/api/voice", voiceRouter);

// ── Interview creation ────────────────────────────────────────────────────────
app.post("/api/v1/pre-interview", async (req, res) => {
  const { success, data, error } = PreInterviewBody.safeParse(req.body);

  if (!success) {
    res.status(400).json({ error: "Invalid request body", details: error.issues });
    return;
  }

  if (data.interviewType === "PROJECT" && !data.projectId) {
    res.status(400).json({ error: "Project selection is required for PROJECT interviews" });
    return;
  }

  if (data.projectId) {
    const processedCount = await prisma.document.count({
      where: { projectId: data.projectId, processingStatus: "PROCESSED" },
    });
    if (processedCount === 0) {
      res.status(400).json({
        error: "At least one processed document is required to start a project interview.",
      });
      return;
    }
  }

  const interview = await prisma.interview.create({
    data: {
      interviewType: data.interviewType,
      projectId: data.projectId ?? null,
      topics: data.topics ?? [],
      status: "Pre",
    },
  });

  res.json({ id: interview.id });
});

// ── Transcript save (still used by voice flow to save individual messages) ────
app.post("/api/v1/session/user/response/:interviewId", async (req, res) => {
  const { message } = req.body;
  await prisma.message.create({
    data: {
      interviewId: req.params.interviewId!,
      type: "User",
      message,
    },
  });
  res.json({ message: "Message saved" });
});

// ── Result ────────────────────────────────────────────────────────────────────
app.get("/api/v1/result/:interviewId", async (req, res) => {
  const interview = await prisma.interview.findFirst({
    where: { id: req.params.interviewId },
    include: { conversations: { orderBy: { createdAt: "asc" } } },
  });

  if (!interview) {
    res.status(404).json({ error: "Interview not found" });
    return;
  }

  res.json({
    interviewType: interview.interviewType,
    score: interview.score,
    feedback: interview.feedback,
    subScores: interview.subScores,
    citations: interview.citations,
    weaknesses: [],
    transcript: interview.conversations.map((c) => ({
      type: c.type,
      content: c.message,
      createdAt: c.createdAt,
    })),
    status: interview.status,
  });

  if (interview.status !== "Done") {
    const usedChunks = interview.usedChunks as any[] | null;
    const result = await calculateResult(
      interview.conversations as any,
      interview.interviewType,
      usedChunks
    );
    await prisma.interview.update({
      where: { id: req.params.interviewId },
      data: {
        status: "Done",
        feedback: result.feedback,
        score: result.score,
        subScores: result.subScores ?? Prisma.JsonNull,
        citations: result.citations ?? [],
      },
    });
  }
});

app.listen(3001, () => {
  console.log("[backend] Server running on http://localhost:3001");
});
