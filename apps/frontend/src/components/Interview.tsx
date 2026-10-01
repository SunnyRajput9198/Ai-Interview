import { BACKEND_URL } from "@/lib/config";
import axios from "axios";
import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import { Bot, Loader2, PhoneOff, User, Mic, MicOff } from "lucide-react";
import { Button } from "./ui/button";
import { VoiceOrb } from "./VoiceOrb";
import { cn } from "@/lib/utils";

type Status =
  | "connecting"
  | "live"
  | "recording"
  | "processing"
  | "ai_speaking"
  | "ending";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface InterviewProgress {
  questionLimit: number;
  questionsAsked: number;
  questionsAnswered: number;
  currentTopic: string | null;
  currentDifficulty: string;
  remainingQuestions: number;
  completed: boolean;
}

function createLevelMeter(ctx: AudioContext, stream: MediaStream) {
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.8;
  source.connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  return () => {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i]! - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / data.length) * 3.5);
  };
}

export function Interview() {
  const { interviewId } = useParams();
  const navigate = useNavigate();

  const [status, setStatus] = useState<Status>("connecting");
  const [userLevel, setUserLevel] = useState(0);
  const [aiLevel, setAiLevel] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lastAiText, setLastAiText] = useState("");
  const [lastUserText, setLastUserText] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [progress, setProgress] = useState<InterviewProgress | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const userMeterRef = useRef<(() => number) | null>(null);
  const aiLevelRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const aiAudioRef = useRef<HTMLAudioElement | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);

  // Keep ref in sync with state so callbacks always have latest messages
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // ── Mic setup on mount ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          ms.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = ms;
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        userMeterRef.current = createLevelMeter(ctx, ms);

        const tick = () => {
          if (userMeterRef.current) setUserLevel(userMeterRef.current());
          setAiLevel(aiLevelRef.current);
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);

        const { data } = await axios.get(
          `${BACKEND_URL}/api/voice/session/${interviewId}`,
        );
        const savedMessages: ChatMessage[] = data.messages ?? [];
        setMessages(savedMessages);
        messagesRef.current = savedMessages;
        setProgress(data.progress ?? null);
        setLastAiText(
          [...savedMessages].reverse().find((m) => m.role === "assistant")
            ?.content ?? "",
        );
        setLastUserText(
          [...savedMessages].reverse().find((m) => m.role === "user")
            ?.content ?? "",
        );
        setStatus("live");
        if (savedMessages.length === 0) await getAiResponse([]);
      } catch (err) {
        console.error("[Interview] Mic setup error:", err);
        const microphoneDenied =
          err instanceof DOMException &&
          ["NotAllowedError", "PermissionDeniedError"].includes(err.name);
        setErrorMsg(
          microphoneDenied
            ? "Microphone access denied. Please allow mic access and refresh."
            : "Could not restore this interview session. Please refresh to try again.",
        );
        setStatus("live");
      }
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewId]);

  // ── Get AI response ─────────────────────────────────────────────────────────
  const getAiResponse = useCallback(
    async (currentMessages: ChatMessage[]) => {
      setStatus("processing");
      setErrorMsg("");
      try {
        const { data } = await axios.post(`${BACKEND_URL}/api/voice/respond`, {
          interviewId,
          messages: currentMessages,
        });
        const aiText: string = data.response ?? "";
        if (data.progress) setProgress(data.progress);
        setLastAiText(aiText);

        const updated = [
          ...currentMessages,
          { role: "assistant" as const, content: aiText },
        ];
        setMessages(updated);
        messagesRef.current = updated;

        await playAiSpeech(aiText);
      } catch (err: any) {
        console.error("[Interview] AI respond error:", err);
        const detail =
          err?.response?.data?.details ?? err?.message ?? "Unknown error";
        setErrorMsg(`AI error: ${detail}`);
        setStatus("live");
      }
    },
    [interviewId],
  );

  // ── TTS playback ────────────────────────────────────────────────────────────
  const playAiSpeech = async (text: string) => {
    setStatus("ai_speaking");
    try {
      const res = await fetch(`${BACKEND_URL}/api/voice/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.details ?? `TTS ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      aiAudioRef.current = audio;

      // Animate AI orb while speaking
      const interval = setInterval(() => {
        aiLevelRef.current = 0.35 + Math.random() * 0.4;
      }, 80);

      await new Promise<void>((resolve) => {
        audio.onended = () => {
          clearInterval(interval);
          aiLevelRef.current = 0;
          URL.revokeObjectURL(url);
          resolve();
        };
        audio.onerror = () => {
          clearInterval(interval);
          aiLevelRef.current = 0;
          resolve();
        };
        audio.play().catch(() => resolve());
      });
    } catch (err: any) {
      console.error("[Interview] TTS error:", err);
      // TTS failure is non-fatal — user can still read the text
    } finally {
      aiLevelRef.current = 0;
      setStatus("live");
    }
  };

  // ── Toggle recording (tap to start / tap to stop) ──────────────────────────
  function toggleRecording() {
    if (status === "recording") {
      stopRecording();
    } else if (status === "live") {
      startRecording();
    }
  }

  function startRecording() {
    if (!streamRef.current) return;
    chunksRef.current = [];

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";

    const recorder = new MediaRecorder(
      streamRef.current,
      mimeType ? { mimeType } : undefined,
    );
    recorderRef.current = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.start(100);
    setStatus("recording");
    setErrorMsg("");
  }

  async function stopRecording() {
    if (!recorderRef.current) return;

    await new Promise<void>((resolve) => {
      recorderRef.current!.onstop = () => resolve();
      recorderRef.current!.stop();
    });

    const mimeType = recorderRef.current.mimeType || "audio/webm";
    const blob = new Blob(chunksRef.current, { type: mimeType });

    if (blob.size < 500) {
      setStatus("live");
      return;
    }

    setStatus("processing");

    try {
      const fd = new FormData();
      fd.append("audio", blob, "recording.webm");

      const { data: transcribeData } = await axios.post(
        `${BACKEND_URL}/api/voice/transcribe`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } },
      );

      const transcript: string = transcribeData.transcript?.trim() ?? "";
      if (!transcript) {
        setStatus("live");
        return;
      }

      setLastUserText(transcript);
      const updatedMessages: ChatMessage[] = [
        ...messagesRef.current,
        { role: "user", content: transcript },
      ];
      setMessages(updatedMessages);
      messagesRef.current = updatedMessages;

      await getAiResponse(updatedMessages);
    } catch (err: any) {
      console.error("[Interview] Processing error:", err);
      const detail =
        err?.response?.data?.details ?? err?.message ?? "Unknown error";
      setErrorMsg(`Transcription error: ${detail}`);
      setStatus("live");
    }
  }

  function cleanup() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
    aiAudioRef.current?.pause();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    aiLevelRef.current = 0;
  }

  function endInterview() {
    setStatus("ending");
    cleanup();
    navigate(`/result/${interviewId}`);
  }

  const isProcessing = status === "processing" || status === "ai_speaking";
  const canRecord = status === "live" || status === "recording";
  const aiSpeaking = status === "ai_speaking";
  const userSpeaking = status === "recording" && userLevel > 0.04;

  // Status label
  const statusLabel = {
    connecting: "Connecting…",
    live: "Interview live",
    recording: "Recording — tap to send",
    processing: "Thinking…",
    ai_speaking: "AI speaking…",
    ending: "Wrapping up…",
  }[status];

  return (
    <main className="flex h-screen w-screen flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border/40">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="relative flex size-2.5">
            <span
              className={cn(
                "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
                status === "recording"
                  ? "bg-red-400"
                  : status === "ai_speaking"
                    ? "bg-violet-400"
                    : status === "live"
                      ? "bg-emerald-400"
                      : "hidden",
              )}
            />
            <span
              className={cn(
                "relative inline-flex size-2.5 rounded-full",
                status === "connecting"
                  ? "bg-amber-400"
                  : status === "recording"
                    ? "bg-red-400"
                    : status === "ai_speaking"
                      ? "bg-violet-400"
                      : status === "ending"
                        ? "bg-muted-foreground"
                        : "bg-emerald-400",
              )}
            />
          </span>
          <span className="transition-all duration-200">{statusLabel}</span>
        </div>
        <span className="text-sm text-muted-foreground font-medium">
          AI Interview
        </span>
      </header>

      {/* Main area */}
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-4 overflow-hidden">
        {status === "connecting" ? (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="size-7 animate-spin" />
            <p className="text-sm">Setting up your interview…</p>
          </div>
        ) : (
          <>
            {progress && (
              <div className="text-center text-xs text-muted-foreground">
                {progress.completed
                  ? `Completed ${progress.questionsAnswered} questions`
                  : `Question ${Math.min(progress.questionsAsked, progress.questionLimit)} of ${progress.questionLimit}`}
                {progress.currentTopic ? ` · ${progress.currentTopic}` : ""}
                {progress.currentDifficulty
                  ? ` · ${progress.currentDifficulty}`
                  : ""}
              </div>
            )}
            {/* Voice orbs */}
            <div className="flex w-full max-w-2xl items-center justify-center gap-16 sm:gap-28">
              <VoiceOrb
                level={aiLevel}
                speaking={aiSpeaking}
                label="Interviewer"
                sublabel={aiSpeaking ? "Speaking" : "Listening"}
                icon={Bot}
                accent="violet"
              />
              <VoiceOrb
                level={userLevel}
                speaking={userSpeaking}
                label="You"
                sublabel={status === "recording" ? "Recording…" : "Mic ready"}
                icon={User}
                accent="emerald"
              />
            </div>

            {/* Conversation bubbles */}
            <div className="w-full max-w-lg flex flex-col gap-2">
              {lastAiText && (
                <div className="rounded-2xl rounded-tl-sm bg-card border border-border/60 px-4 py-3 text-sm leading-relaxed">
                  <span className="text-xs font-semibold text-violet-400 block mb-1">
                    Interviewer
                  </span>
                  {lastAiText}
                </div>
              )}
              {lastUserText && (
                <div className="rounded-2xl rounded-tr-sm bg-primary/10 border border-primary/20 px-4 py-3 text-sm leading-relaxed self-end text-right">
                  <span className="text-xs font-semibold text-emerald-400 block mb-1">
                    You
                  </span>
                  {lastUserText}
                </div>
              )}
            </div>

            {/* Error */}
            {errorMsg && (
              <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2 max-w-md text-center">
                {errorMsg}
              </p>
            )}

            {/* Big record button */}
            <div className="flex flex-col items-center gap-3 mt-2">
              <button
                onClick={toggleRecording}
                disabled={isProcessing || Boolean(progress?.completed)}
                className={cn(
                  "relative flex size-20 items-center justify-center rounded-full transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  status === "recording"
                    ? "bg-red-500 shadow-[0_0_0_12px_rgba(239,68,68,0.15)] scale-110"
                    : isProcessing
                      ? "bg-muted cursor-not-allowed scale-95"
                      : "bg-primary shadow-[0_0_0_8px_rgba(var(--primary),0.12)] hover:scale-105 active:scale-95",
                )}
              >
                {isProcessing ? (
                  <Loader2 className="size-8 animate-spin text-muted-foreground" />
                ) : status === "recording" ? (
                  <MicOff className="size-8 text-white" />
                ) : (
                  <Mic className="size-8 text-primary-foreground" />
                )}

                {/* Pulse ring when recording */}
                {status === "recording" && (
                  <>
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-400 opacity-30" />
                    <span className="absolute inline-flex size-[calc(100%+20px)] animate-ping rounded-full bg-red-400 opacity-10 animation-delay-150" />
                  </>
                )}
              </button>

              <p className="text-xs text-muted-foreground">
                {status === "recording"
                  ? "🔴 Recording — tap to send"
                  : isProcessing
                    ? status === "ai_speaking"
                      ? "AI is speaking…"
                      : "Processing…"
                    : "Tap to speak"}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <footer className="flex justify-center px-6 py-4 border-t border-border/40">
        <Button
          variant="ghost"
          size="sm"
          onClick={endInterview}
          disabled={
            status === "ending" || isProcessing || status === "recording"
          }
          className="gap-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
        >
          {status === "ending" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <PhoneOff className="size-4" />
          )}
          {progress?.completed ? "View Results" : "End Interview"}
        </Button>
      </footer>
    </main>
  );
}
