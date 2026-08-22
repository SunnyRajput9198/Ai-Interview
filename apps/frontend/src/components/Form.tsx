import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { toast } from "sonner";
import axios from "axios";
import { BACKEND_URL } from "@/lib/config";
import { useNavigate, useSearchParams } from "react-router";
import { ArrowRight, Loader2, Mic, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

type InterviewType = "TECHNICAL" | "PROJECT" | "HR" | "FULL";

interface Project {
  id: string;
  name: string;
  documentCount: number;
}

export function Form() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [interviewType, setInterviewType] = useState<InterviewType>(
    (searchParams.get("type") as InterviewType) ?? "TECHNICAL"
  );
  const [projectId, setProjectId] = useState(searchParams.get("projectId") ?? "");
  const [topics, setTopics] = useState<string[]>([]);
  const [topicInput, setTopicInput] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [projectError, setProjectError] = useState("");

  // Fetch projects for PROJECT type
  useEffect(() => {
    if (interviewType === "PROJECT") {
      axios
        .get(`${BACKEND_URL}/api/projects`)
        .then((r) => setProjects(r.data))
        .catch(console.error);
    }
  }, [interviewType]);

  function addTopic(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const t = topicInput.trim().replace(/,$/, "");
      if (t && !topics.includes(t)) setTopics((prev) => [...prev, t]);
      setTopicInput("");
    }
  }

  function removeTopic(t: string) {
    setTopics((prev) => prev.filter((x) => x !== t));
  }

  async function onSubmit() {
    if (interviewType === "PROJECT" && !projectId) {
      setProjectError("Please select a project to start a project interview.");
      return;
    }
    setProjectError("");
    setLoading(true);

    try {
      const response = await axios.post(`${BACKEND_URL}/api/v1/pre-interview`, {
        interviewType,
        ...(interviewType === "PROJECT" && projectId ? { projectId } : {}),
        ...(interviewType === "TECHNICAL" && topics.length > 0 ? { topics } : {}),
      });
      navigate(`/interview/${response.data.id}`);
    } catch (e: any) {
      const msg =
        e?.response?.data?.error ??
        "Something went wrong starting your interview. Please try again.";
      toast(msg);
      setLoading(false);
    }
  }

  return (
    <main className="flex h-[calc(100vh-3.5rem)] w-screen items-center justify-center overflow-hidden px-6">
      <div className="flex w-full max-w-xl flex-col items-center text-center">
        <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
          <Mic className="size-3.5 text-primary" />
          Voice-based AI interview
        </span>

        <h1 className="bg-gradient-to-b from-foreground to-foreground/60 bg-clip-text text-4xl font-bold tracking-tight text-transparent sm:text-5xl">
          Start an Interview
        </h1>
        <p className="mt-4 max-w-md text-balance text-base text-muted-foreground">
          Choose your interview type, optionally select a project or topics, then go
          live — AI will ask questions grounded in your uploaded documents.
        </p>

        <div className="mt-10 w-full space-y-3">
          {/* Interview type */}
          <div className="rounded-xl border border-border bg-card/60 p-2 shadow-sm backdrop-blur">
            <Select
              value={interviewType}
              onValueChange={(v) => {
                setInterviewType(v as InterviewType);
                setProjectId("");
                setProjectError("");
              }}
              disabled={loading}
            >
              <SelectTrigger className="w-full border-0 bg-transparent shadow-none focus:ring-0">
                <SelectValue placeholder="Interview type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TECHNICAL">Technical Interview</SelectItem>
                <SelectItem value="PROJECT">Project Interview</SelectItem>
                <SelectItem value="HR">HR / Behavioural Interview</SelectItem>
                <SelectItem value="FULL">Full Interview</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Project selector (PROJECT type) */}
          {interviewType === "PROJECT" && (
            <div className="rounded-xl border border-border bg-card/60 p-2 shadow-sm backdrop-blur">
              <Select
                value={projectId || "__none__"}
                onValueChange={(v) => {
                  setProjectId(v === "__none__" ? "" : v);
                  setProjectError("");
                }}
                disabled={loading}
              >
                <SelectTrigger className="w-full border-0 bg-transparent shadow-none focus:ring-0">
                  <SelectValue placeholder="Select a project…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" disabled>
                    — Select a project —
                  </SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.documentCount} doc{p.documentCount !== 1 ? "s" : ""})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {projectError && (
            <p className="text-left text-xs text-destructive">{projectError}</p>
          )}

          {/* Topics (TECHNICAL type) */}
          {interviewType === "TECHNICAL" && (
            <div className="rounded-xl border border-border bg-card/60 p-3 shadow-sm backdrop-blur">
              <Input
                value={topicInput}
                onChange={(e) => setTopicInput(e.target.value)}
                onKeyDown={addTopic}
                placeholder="Topics: Node.js, AWS, Docker… (Enter to add)"
                disabled={loading}
                className="border-0 bg-transparent shadow-none focus-visible:ring-0"
              />
              {topics.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5 px-1">
                  {topics.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary"
                    >
                      {t}
                      <button onClick={() => removeTopic(t)} disabled={loading}>
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Submit */}
          <Button
            disabled={loading}
            onClick={onSubmit}
            size="lg"
            className="w-full gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Starting…
              </>
            ) : (
              <>
                Start Interview
                <ArrowRight className="size-4" />
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground">
            Microphone access will be requested when the interview begins.
          </p>
        </div>
      </div>
    </main>
  );
}
