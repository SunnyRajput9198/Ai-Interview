import { BACKEND_URL } from "@/lib/config";
import axios from "axios";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  Bot,
  Loader2,
  Sparkles,
  User,
  FileText,
  AlertTriangle,
  ChevronDown,
} from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

interface SubScores {
  architectureUnderstanding: number;
  technologyDecisions: number;
  implementationKnowledge: number;
  databaseKnowledge: number;
  scalingKnowledge: number;
  securityKnowledge: number;
  tradeoffUnderstanding: number;
}

interface ResultData {
  transcript: {
    type: "Assistant" | "User";
    content: string;
    createdAt: string;
  }[];
  score: number;
  feedback: string;
  status: "Done" | "InProgress" | "Pre";
  interviewType?: string;
  subScores?: SubScores;
  citations?: string[];
  weaknesses?: string[];
  adaptiveSummary?: {
    questionsAsked: number;
    questionsAnswered: number;
    averageScore: number | null;
    weakTopics: string[];
    strongTopics: string[];
    topicScores: { topic: string; scores: number[] }[];
  } | null;
}

const SUB_SCORE_LABELS: Record<keyof SubScores, string> = {
  architectureUnderstanding: "Architecture",
  technologyDecisions: "Tech Decisions",
  implementationKnowledge: "Implementation",
  databaseKnowledge: "Database",
  scalingKnowledge: "Scaling",
  securityKnowledge: "Security",
  tradeoffUnderstanding: "Trade-offs",
};

function ScoreBar({ score }: { score: number }) {
  const pct = (score / 10) * 100;
  const color =
    score >= 7
      ? "bg-emerald-400"
      : score >= 4
        ? "bg-amber-400"
        : "bg-destructive";
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 text-xs font-semibold tabular-nums">
        {score}
        <span className="text-muted-foreground">/10</span>
      </span>
    </div>
  );
}

export function Result() {
  const { interviewId } = useParams();
  const navigate = useNavigate();
  const [result, setResult] = useState<ResultData>({
    score: 0,
    feedback: "",
    transcript: [],
    status: "Pre",
  });
  const [weaknessOpen, setWeaknessOpen] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const fetchResult = async () => {
      try {
        const response = await axios.get(
          `${BACKEND_URL}/api/v1/result/${interviewId}`,
        );
        if (!active) return null;
        setResult(response.data);
        setLoadError("");
        const status = response.data.status as ResultData["status"];
        if (status === "Done" && intervalId) clearInterval(intervalId);
        return status;
      } catch {
        if (active) {
          setLoadError("Unable to load results. Reload the page to retry.");
        }
        if (intervalId) clearInterval(intervalId);
        return null;
      }
    };

    void fetchResult();
    intervalId = setInterval(async () => {
      const s = await fetchResult();
      if (s === "Done") clearInterval(intervalId);
    }, 5000);

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [interviewId]);

  const ready = result.status === "Done";
  const isProject = result.interviewType === "PROJECT";

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-12">
      <header className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Interview Results
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your feedback and full conversation transcript.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate("/interview/new")}>
          New Interview
        </Button>
      </header>

      {!ready ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border bg-card/50 py-24 text-center">
          {loadError ? (
            <p role="alert" className="text-sm text-destructive">
              {loadError}
            </p>
          ) : (
            <Loader2 className="size-7 animate-spin text-muted-foreground" />
          )}
          <div>
            <p className="font-medium">
              {loadError ? "Results unavailable" : "Analysing your interview…"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {loadError
                ? "We’ll try again in a few seconds."
                : "This usually takes a few seconds."}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {/* Overall score + feedback */}
          <section className="rounded-xl border border-border bg-card/60 p-6 backdrop-blur">
            <div className="flex items-start justify-between gap-6">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Sparkles className="size-4 text-violet-400" />
                AI Feedback
                {result.interviewType && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs uppercase">
                    {result.interviewType}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-baseline gap-1">
                <span className="text-3xl font-bold tracking-tight">
                  {result.score}
                </span>
                <span className="text-sm text-muted-foreground">/ 10</span>
              </div>
            </div>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
              {result.feedback}
            </p>
          </section>

          {/* Project sub-scores */}
          {result.adaptiveSummary &&
            result.adaptiveSummary.questionsAnswered > 0 && (
              <section className="rounded-xl border border-border bg-card/60 p-6">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold">
                    Adaptive performance
                  </h2>
                  {result.adaptiveSummary.averageScore !== null && (
                    <span className="text-xs text-muted-foreground">
                      Turn average{" "}
                      {result.adaptiveSummary.averageScore.toFixed(1)}/10
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {result.adaptiveSummary.questionsAnswered} answers ·
                  difficulty and follow-ups adapted during the session
                </p>
                {result.adaptiveSummary.topicScores.length > 0 && (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {result.adaptiveSummary.topicScores.map((item) => {
                      const avg =
                        item.scores.reduce((sum, score) => sum + score, 0) /
                        item.scores.length;
                      return (
                        <div
                          key={item.topic}
                          className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2 text-xs"
                        >
                          <span>{item.topic}</span>
                          <span className="font-medium tabular-nums">
                            {avg.toFixed(1)}/10
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {(result.adaptiveSummary.weakTopics.length > 0 ||
                  result.adaptiveSummary.strongTopics.length > 0) && (
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    {result.adaptiveSummary.weakTopics.map((topic) => (
                      <span
                        key={`weak-${topic}`}
                        className="rounded-full bg-amber-400/10 px-2.5 py-1 text-amber-300"
                      >
                        Revisit · {topic}
                      </span>
                    ))}
                    {result.adaptiveSummary.strongTopics.map((topic) => (
                      <span
                        key={`strong-${topic}`}
                        className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-emerald-300"
                      >
                        Strong · {topic}
                      </span>
                    ))}
                  </div>
                )}
              </section>
            )}

          {/* Project sub-scores */}
          {isProject && result.subScores && (
            <section className="rounded-xl border border-border bg-card/60 p-6">
              <h2 className="mb-4 text-sm font-semibold">
                Project Understanding Breakdown
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {(Object.keys(result.subScores) as (keyof SubScores)[]).map(
                  (key) => (
                    <div key={key} className="rounded-lg bg-muted/30 p-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        {SUB_SCORE_LABELS[key]}
                      </p>
                      <ScoreBar score={result.subScores![key]} />
                    </div>
                  ),
                )}
              </div>
            </section>
          )}

          {/* Citations */}
          {result.citations && result.citations.length > 0 && (
            <section className="rounded-xl border border-border bg-card/60 p-5">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <FileText className="size-4 text-muted-foreground" />
                Based on
              </div>
              <div className="flex flex-wrap gap-2">
                {result.citations.map((c) => (
                  <span
                    key={c}
                    className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Weaknesses */}
          {result.weaknesses && result.weaknesses.length > 0 && (
            <section className="rounded-xl border border-border bg-card/60 p-5">
              <button
                className="flex w-full items-center justify-between text-sm font-medium"
                onClick={() => setWeaknessOpen((v) => !v)}
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="size-4 text-amber-400" />
                  Areas for Improvement ({result.weaknesses.length})
                </div>
                <ChevronDown
                  className={cn(
                    "size-4 transition-transform",
                    weaknessOpen && "rotate-180",
                  )}
                />
              </button>
              {weaknessOpen && (
                <ul className="mt-3 flex flex-col gap-2">
                  {result.weaknesses.map((w, i) => (
                    <li
                      key={i}
                      className="flex gap-2 text-sm text-muted-foreground"
                    >
                      <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-amber-400/60 mt-1.5" />
                      {w}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Transcript */}
          <section>
            <h2 className="mb-4 text-sm font-medium text-muted-foreground">
              Conversation
            </h2>
            <div className="flex flex-col gap-4">
              {result.transcript.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No messages were recorded for this interview.
                </p>
              )}
              {result.transcript.map((m, i) => {
                const isAi = m.type === "Assistant";
                return (
                  <div
                    key={i}
                    className={cn(
                      "flex gap-3",
                      isAi ? "justify-start" : "flex-row-reverse",
                    )}
                  >
                    <div
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-full text-white",
                        isAi
                          ? "bg-gradient-to-br from-violet-400 to-indigo-600"
                          : "bg-gradient-to-br from-emerald-300 to-teal-600",
                      )}
                    >
                      {isAi ? (
                        <Bot className="size-4" />
                      ) : (
                        <User className="size-4" />
                      )}
                    </div>
                    <div
                      className={cn(
                        "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                        isAi
                          ? "rounded-tl-sm bg-card text-foreground"
                          : "rounded-tr-sm bg-primary text-primary-foreground",
                      )}
                    >
                      {m.content}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
