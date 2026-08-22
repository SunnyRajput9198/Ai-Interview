import { Router } from "express";
import type { Request, Response } from "express";
import multer from "multer";
import { prisma } from "../db";
import { retrieveForQuestion } from "../knowledge-retrieval";
import { buildInterviewSystemPrompt } from "../prompt-builder";

const router = Router();
const audioUpload = multer({ storage: multer.memoryStorage() });
const BASE_URL = "https://api.aicredits.in/v1";

function authHeader(): string {
  return `Bearer ${process.env.OPENAI_KEY}`;
}

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
      formData.append("model", "openai/whisper-1");
      formData.append(
        "file",
        new Blob([uint8], { type: req.file.mimetype }),
        req.file.originalname || "audio.webm"
      );

      const response = await fetch(`${BASE_URL}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: authHeader() },
        // No Content-Type — FormData sets multipart/form-data + boundary automatically
        body: formData,
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("[voice/transcribe] AICredits error:", errText);
        res.status(response.status).json({ error: "Transcription failed", details: errText });
        return;
      }

      const data = (await response.json()) as { text?: string };
      const transcript = data.text?.trim() ?? "";
      console.log("[voice/transcribe]", transcript);
      res.json({ transcript });
    } catch (err) {
      console.error("[voice/transcribe] Error:", err);
      res.status(500).json({ error: "Transcription failed" });
    }
  }
);

// ── POST /api/voice/respond ───────────────────────────────────────────────────
// Sends conversation history to AICredits chat completions.
router.post("/respond", async (req: Request, res: Response) => {
  try {
    const {
      interviewId,
      messages,
    }: {
      interviewId: string;
      messages: { role: "system" | "user" | "assistant"; content: string }[];
    } = req.body;

    if (!interviewId || !Array.isArray(messages)) {
      res.status(400).json({ error: "interviewId and messages array are required" });
      return;
    }

    // Build system prompt once (inject context if no system message present yet)
    let systemPrompt: string | null = null;
    if (!messages.some((m) => m.role === "system")) {
      const interview = await prisma.interview.findUnique({ where: { id: interviewId } });

      if (interview) {
        let project: { name: string; description: string | null; technologies: string[] } | null =
          null;
        if (interview.projectId) {
          project = await prisma.project.findUnique({
            where: { id: interview.projectId },
            select: { name: true, description: true, technologies: true },
          });
        }

        let retrievedChunks: Awaited<ReturnType<typeof retrieveForQuestion>> = [];
        try {
          const lastUser = [...messages].reverse().find((m) => m.role === "user");
          if (lastUser?.content) {
            retrievedChunks = await retrieveForQuestion({
              interviewType: interview.interviewType as "TECHNICAL" | "PROJECT" | "HR" | "FULL",
              projectId: interview.projectId ?? undefined,
              questionText: lastUser.content,
              topK: 6,
            });
            if (retrievedChunks.length > 0) {
              await prisma.interview.update({
                where: { id: interviewId },
                data: { usedChunks: retrievedChunks as any },
              });
            }
          }
        } catch (e) {
          console.warn("[voice/respond] RAG failed (no embeddings?):", e);
        }

        systemPrompt = buildInterviewSystemPrompt({
          interviewType: interview.interviewType,
          project,
          topics: interview.topics,
          retrievedChunks,
          conversations: [],
        });
      }
    }

    const finalMessages = systemPrompt
      ? [{ role: "system" as const, content: systemPrompt }, ...messages]
      : messages;

    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: finalMessages,
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[voice/respond] AICredits error:", errText);
      res.status(response.status).json({ error: "AI response failed", details: errText });
      return;
    }

    const data = (await response.json()) as {
      choices: { message: { content: string } }[];
    };
    const aiText = data.choices[0]?.message?.content?.trim() ?? "";

    // Persist both turns to DB
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser?.content) {
      await prisma.message.create({
        data: { interviewId, type: "User", message: lastUser.content },
      });
    }
    if (aiText) {
      await prisma.message.create({
        data: { interviewId, type: "Assistant", message: aiText },
      });
    }

    res.json({ response: aiText });
  } catch (err) {
    console.error("[voice/respond] Error:", err);
    res.status(500).json({ error: "AI response failed" });
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

    const response = await fetch(`${BASE_URL}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/tts-1",
        input: text.slice(0, 4096),
        voice: "alloy",
        response_format: "mp3",
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[voice/speak] AICredits error:", errText);
      res.status(response.status).json({ error: "TTS failed", details: errText });
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
