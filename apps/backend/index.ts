import express from "express";
import cors from "cors";
import { prisma, Prisma } from "./db";
import { calculateResult } from "./result";
import { PreInterviewBody } from "./types";
import { RetrievedChunksSchema } from "./knowledge-retrieval";
import projectsRouter from "./routes/projects";
import documentsRouter from "./routes/documents";
import dashboardRouter from "./routes/dashboard";
import voiceRouter from "./routes/voice";
import learningRouter from "./routes/learning";

const app = express();
const evaluationJobs = new Map<string, ReturnType<typeof calculateResult>>();
app.use(express.json());
app.use(cors());

// ── Knowledge / project routes ────────────────────────────────────────────────
app.use("/api/projects", projectsRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/dashboard", dashboardRouter);

// ── Voice interview routes (chunk-based: transcribe → respond → speak) ────────
app.use("/api/voice", voiceRouter);
app.use("/api/learning", learningRouter);

// ── Interview creation ────────────────────────────────────────────────────────
app.post("/api/v1/pre-interview", async (req, res) => {
  const { success, data, error } = PreInterviewBody.safeParse(req.body);

  if (!success) {
    res
      .status(400)
      .json({ error: "Invalid request body", details: error.issues });
    return;
  }

  if (data.interviewType === "PROJECT" && !data.projectId) {
    res
      .status(400)
      .json({ error: "Project selection is required for PROJECT interviews" });
    return;
  }

  if (data.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: data.projectId },
      select: { id: true },
    });
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (data.interviewType === "PROJECT") {
      const processedCount = await prisma.document.count({
        where: { projectId: data.projectId, processingStatus: "PROCESSED" },
      });
      if (processedCount === 0) {
        res.status(400).json({
          error:
            "At least one processed document is required to start a project interview.",
        });
        return;
      }
    }
  }

  const interview = await prisma.interview.create({
    data: {
      interviewType: data.interviewType,
      projectId: data.projectId ?? null,
      topics: data.topics ?? [],
      adaptiveState: {
        questionLimit: data.questionLimit,
        questionsAsked: 0,
        questionsAnswered: 0,
        currentTopic: null,
        currentDifficulty: "intermediate",
        systemDesignStage:
          data.interviewType === "SYSTEM_DESIGN" ? "requirements" : null,
        topicScores: [],
        averageScore: null,
        weakTopics: [],
        strongTopics: [],
        recentAnswerQuality: null,
        remainingQuestions: data.questionLimit,
        interviewGoal: data.interviewType.toLowerCase().replaceAll("_", " "),
        recentGaps: [],
        completed: false,
      },
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
  const interviewId = req.params.interviewId!;
  const interview = await prisma.interview.findFirst({
    where: { id: interviewId },
    include: { conversations: { orderBy: { createdAt: "asc" } } },
  });

  if (!interview) {
    res.status(404).json({ error: "Interview not found" });
    return;
  }

  let evaluation: Awaited<ReturnType<typeof calculateResult>> | null = null;
  if (interview.status !== "Done") {
    const parsedChunks = RetrievedChunksSchema.safeParse(interview.usedChunks);
    const usedChunks = parsedChunks.success ? parsedChunks.data : null;
    let job = evaluationJobs.get(interviewId);
    if (!job) {
      job = calculateResult(
        interview.conversations,
        interview.interviewType,
        usedChunks,
      ).then(async (result) => {
        await prisma.interview.update({
          where: { id: interviewId },
          data: {
            status: "Done",
            feedback: result.feedback,
            score: result.score,
            subScores: result.subScores ?? Prisma.JsonNull,
            citations: result.citations ?? [],
            weaknesses: result.weaknesses ?? [],
          },
        });
        return result;
      });
      evaluationJobs.set(interviewId, job);
      void job.then(
        () => {
          if (evaluationJobs.get(interviewId) === job) {
            evaluationJobs.delete(interviewId);
          }
        },
        () => {
          if (evaluationJobs.get(interviewId) === job) {
            evaluationJobs.delete(interviewId);
          }
        },
      );
    }

    try {
      evaluation = await job;
    } catch (error) {
      console.error(`[result] Evaluation failed for ${interviewId}:`, error);
      res.status(502).json({ error: "Interview evaluation failed" });
      return;
    }
  }

  res.json({
    interviewType: interview.interviewType,
    score: evaluation?.score ?? interview.score,
    feedback: evaluation?.feedback ?? interview.feedback,
    subScores: evaluation?.subScores ?? interview.subScores,
    citations: evaluation?.citations ?? interview.citations,
    weaknesses: evaluation?.weaknesses ?? interview.weaknesses,
    adaptiveSummary: interview.adaptiveState,
    transcript: interview.conversations.map((c) => ({
      type: c.type,
      content: c.message,
      createdAt: c.createdAt,
    })),
    status: evaluation ? "Done" : interview.status,
  });
});

app.listen(3001, () => {
  console.log("[backend] Server running on http://localhost:3001");
});
