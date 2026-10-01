import { Router } from "express";
import type { Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma, Prisma } from "../db";
import { retrieveForQuestion } from "../knowledge-retrieval";
import {
  AdaptiveStateSchema,
  evaluateAndChooseNext,
  isDuplicateSubmission,
  openingQuestion,
  replaceRepeatedQuestion,
  updateAdaptiveState,
} from "../adaptive-interviewer";
import { createKeyedLock } from "../interview-concurrency";
import { InterviewCategorySchema } from "../learning-service";
import {
  SPEECH_MODEL,
  TRANSCRIPTION_MODEL,
  VOICE_API_BASE_URL,
} from "../config";

const router = Router();
const audioUpload = multer({ storage: multer.memoryStorage() });
const interviewResponseLock = createKeyedLock();
const voiceResponseBody = z.object({
  interviewId: z.string().uuid(),
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().min(1),
    }),
  ),
});

function authHeader(): string {
  return `Bearer ${process.env.OPENAI_KEY}`;
}

function readAdaptiveState(value: unknown) {
  return AdaptiveStateSchema.safeParse(value);
}

function serializedChunks(
  chunks: Awaited<ReturnType<typeof retrieveForQuestion>>,
) {
  return chunks.map(({ content, chunkIndex, documentId, documentName }) => ({
    content,
    chunkIndex,
    documentId,
    documentName,
  }));
}

router.get("/session/:interviewId", async (req: Request, res: Response) => {
  try {
    const interviewId = String(req.params.interviewId);
    const interview = await prisma.interview.findUnique({
      where: { id: interviewId },
      include: { conversations: { orderBy: { createdAt: "asc" } } },
    });
    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }
    const parsed = readAdaptiveState(interview.adaptiveState);
    res.json({
      interviewType: interview.interviewType,
      status: interview.status,
      messages: interview.conversations.map((m) => ({
        role: m.type === "User" ? "user" : "assistant",
        content: m.message,
      })),
      progress: parsed.success ? parsed.data : null,
    });
  } catch (error) {
    console.error("[voice/session] Error:", error);
    res.status(500).json({ error: "Could not load interview session" });
  }
});

// ── POST /api/voice/transcribe ────────────────────────────────────────────────
// Sends audio to AICredits Whisper API.
// Uses native FormData — does NOT set Content-Type manually (browser sets boundary).
router.post(
  "/transcribe",
  audioUpload.single("audio"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No audio file provided" });
        return;
      }

      // Convert Buffer to Uint8Array — valid BlobPart in all TS targets
      const uint8 = new Uint8Array(req.file.buffer);

      const formData = new FormData();
      formData.append("model", TRANSCRIPTION_MODEL);
      formData.append(
        "file",
        new Blob([uint8], { type: req.file.mimetype }),
        req.file.originalname || "audio.webm",
      );

      const response = await fetch(
        `${VOICE_API_BASE_URL}/audio/transcriptions`,
        {
          method: "POST",
          headers: { Authorization: authHeader() },
          // No Content-Type — FormData sets multipart/form-data + boundary automatically
          body: formData,
        },
      );

      if (!response.ok) {
        console.error(
          "[voice/transcribe] AICredits request failed:",
          response.status,
        );
        res.status(502).json({ error: "Transcription failed" });
        return;
      }

      const data = (await response.json()) as { text?: string };
      const transcript = data.text?.trim() ?? "";
      res.json({ transcript });
    } catch (err) {
      console.error("[voice/transcribe] Error:", err);
      res.status(500).json({ error: "Transcription failed" });
    }
  },
);

// ── POST /api/voice/respond ───────────────────────────────────────────────────
// Sends conversation history to AICredits chat completions.
router.post("/respond", async (req: Request, res: Response) => {
  let releaseLock: (() => void) | undefined;
  try {
    const parsedBody = voiceResponseBody.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({
        error: "Invalid interview response request",
        details: parsedBody.error.issues,
      });
      return;
    }
    const { interviewId, messages } = parsedBody.data;
    releaseLock = await interviewResponseLock.acquire(interviewId);

    const interview = await prisma.interview.findUnique({
      where: { id: interviewId },
    });
    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }
    if (interview.status === "Done") {
      res.status(409).json({ error: "Interview is already complete" });
      return;
    }
    const stateResult = readAdaptiveState(interview.adaptiveState);
    const state = stateResult.success
      ? stateResult.data
      : AdaptiveStateSchema.parse({
          questionLimit: 8,
          questionsAsked: await prisma.message.count({
            where: { interviewId, type: "Assistant" },
          }),
          questionsAnswered: await prisma.message.count({
            where: { interviewId, type: "User" },
          }),
        });
    if (state.completed) {
      res.status(409).json({ error: "Interview question limit reached" });
      return;
    }

    let project: {
      name: string;
      description: string | null;
      technologies: string[];
    } | null = null;
    if (interview.projectId) {
      project = await prisma.project.findUnique({
        where: { id: interview.projectId },
        select: { name: true, description: true, technologies: true },
      });
    }

    const storedMessages = await prisma.message.findMany({
      where: { interviewId },
      orderBy: { createdAt: "asc" },
    });
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (isDuplicateSubmission(messages, storedMessages)) {
      const lastAssistant = [...storedMessages]
        .reverse()
        .find((message) => message.type === "Assistant");
      res.json({
        response: lastAssistant?.message ?? "",
        progress: state,
        duplicate: true,
      });
      return;
    }
    let retrievedChunks: Awaited<ReturnType<typeof retrieveForQuestion>> = [];
    try {
      const query =
        lastUser?.content ??
        [
          interview.interviewType,
          ...interview.topics,
          project?.name ?? "",
        ].join(" ");
      retrievedChunks = await retrieveForQuestion({
        interviewType: interview.interviewType,
        projectId: interview.projectId ?? undefined,
        questionText: `${state.currentTopic ?? ""} ${query}`,
        topK: 6,
      });
    } catch (error) {
      console.warn("[voice/respond] RAG retrieval failed:", error);
    }

    const [priorInterviews, practiceSessions] = await Promise.all([
      prisma.interview.findMany({
        where: {
          ...(interview.projectId ? { projectId: interview.projectId } : {}),
          status: "Done",
          id: { not: interviewId },
        },
        select: { weaknesses: true, subScores: true },
        orderBy: { updatedAt: "desc" },
        take: 8,
      }),
      prisma.learningSession.findMany({
        where: {
          kind: "PRACTICE",
          ...(interview.projectId ? { projectId: interview.projectId } : {}),
        },
        select: { state: true, answers: true },
        orderBy: { updatedAt: "desc" },
        take: 30,
      }),
    ]);
    const previousWeaknesses = priorInterviews
      .flatMap((item) => {
        const subScores = item.subScores;
        const weakScores =
          subScores &&
          typeof subScores === "object" &&
          !Array.isArray(subScores)
            ? Object.entries(subScores)
                .filter(([, score]) => typeof score === "number" && score < 6)
                .map(([topic]) => topic)
            : [];
        return [...item.weaknesses, ...weakScores];
      })
      .slice(0, 8);
    const practiceByCategory = new Map<
      string,
      { total: number; count: number }
    >();
    for (const session of practiceSessions) {
      const state = z
        .object({ category: InterviewCategorySchema })
        .safeParse(session.state);
      const answers = z
        .array(
          z.object({
            evaluation: z.object({ score: z.number().min(0).max(10) }),
          }),
        )
        .safeParse(session.answers);
      if (!state.success || !answers.success) continue;
      const bucket = practiceByCategory.get(state.data.category) ?? {
        total: 0,
        count: 0,
      };
      for (const answer of answers.data) {
        bucket.total += answer.evaluation.score;
        bucket.count += 1;
      }
      practiceByCategory.set(state.data.category, bucket);
    }
    for (const [category, bucket] of practiceByCategory) {
      const average = bucket.total / bucket.count;
      if (bucket.count && average < 7)
        previousWeaknesses.push(
          `${category} practice (${average.toFixed(1)}/10)`,
        );
    }
    const recentHistory = storedMessages.slice(-12).map((m) => ({
      type: m.type,
      message: m.message,
    }));
    if (lastUser)
      recentHistory.push({ type: "User", message: lastUser.content });
    const context = {
      interviewType: interview.interviewType,
      project,
      topics: interview.topics,
      chunks: retrievedChunks,
      priorWeaknesses: previousWeaknesses,
      recentHistory,
      state,
    };

    let aiText = "";
    let nextState = state;
    let turnEvaluation: {
      score: number;
      topic: string;
      strengths: string[];
      gaps: string[];
    } | null = null;
    if (lastUser) {
      const lastQuestion =
        [...storedMessages].reverse().find((m) => m.type === "Assistant")
          ?.message ?? "Opening question";
      const turn = await evaluateAndChooseNext({
        ...context,
        lastQuestion,
        answer: lastUser.content,
      });
      nextState = updateAdaptiveState(state, turn, interview.interviewType);
      turnEvaluation = {
        score: turn.score,
        topic: turn.topic,
        strengths: turn.strengths,
        gaps: turn.gaps,
      };
      const nextQuestion = replaceRepeatedQuestion({
        candidate: turn.nextQuestion,
        previousQuestions: storedMessages
          .filter((message) => message.type === "Assistant")
          .map((message) => message.message),
        topic: turn.nextTopic,
        gaps: turn.gaps,
      });
      aiText = nextState.completed
        ? "Thank you for completing the interview. You can end the session to see your performance report."
        : nextQuestion;
    } else {
      const opening = await openingQuestion(context);
      nextState = AdaptiveStateSchema.parse({
        ...state,
        questionsAsked: state.questionsAsked + 1,
        currentTopic: opening.topic,
        currentDifficulty: opening.difficulty,
        systemDesignStage:
          interview.interviewType === "SYSTEM_DESIGN" ? "requirements" : null,
        remainingQuestions: Math.max(0, state.questionLimit - 1),
      });
      aiText = opening.question;
    }

    // Commit the response and adaptive state as one compare-and-set transaction.
    const committed = await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.interview.updateMany({
        where: {
          id: interviewId,
          status: { not: "Done" },
          updatedAt: interview.updatedAt,
        },
        data: {
          status: interview.status === "Pre" ? "InProgress" : interview.status,
          adaptiveState: nextState as unknown as Prisma.InputJsonValue,
          ...(retrievedChunks.length > 0
            ? {
                usedChunks: serializedChunks(
                  retrievedChunks,
                ) as Prisma.InputJsonArray,
              }
            : {}),
        },
      });
      if (claimed.count !== 1) return false;
      if (lastUser?.content) {
        await transaction.message.create({
          data: { interviewId, type: "User", message: lastUser.content },
        });
      }
      if (aiText) {
        await transaction.message.create({
          data: { interviewId, type: "Assistant", message: aiText },
        });
      }
      return true;
    });
    if (!committed) {
      res.status(409).json({
        error:
          "Interview changed while this answer was being processed. Reload the session.",
      });
      return;
    }

    if (turnEvaluation) {
      res.json({
        response: aiText,
        evaluation: turnEvaluation,
        progress: nextState,
      });
    } else {
      res.json({ response: aiText, progress: nextState });
    }
  } catch (err) {
    console.error("[voice/respond] Error:", err);
    res.status(500).json({ error: "AI response failed" });
  } finally {
    releaseLock?.();
  }
});

// ── POST /api/voice/speak ─────────────────────────────────────────────────────
// Calls AICredits TTS and returns raw mp3 audio.
router.post("/speak", async (req: Request, res: Response) => {
  try {
    const { text }: { text?: string } = req.body;

    if (!text?.trim()) {
      res.status(400).json({ error: "text is required" });
      return;
    }

    const response = await fetch(`${VOICE_API_BASE_URL}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: SPEECH_MODEL,
        input: text.slice(0, 4096),
        voice: "alloy",
        response_format: "mp3",
      }),
    });

    if (!response.ok) {
      console.error("[voice/speak] AICredits request failed:", response.status);
      res.status(502).json({ error: "TTS failed" });
      return;
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    res.set("Content-Type", "audio/mpeg");
    res.set("Content-Length", String(audioBuffer.byteLength));
    res.send(audioBuffer);
  } catch (err) {
    console.error("[voice/speak] Error:", err);
    res.status(500).json({ error: "TTS failed" });
  }
});

export default router;
