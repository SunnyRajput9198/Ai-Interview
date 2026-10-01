import { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router";
import {
  ArrowRight,
  Brain,
  BookOpenCheck,
  ChartNoAxesCombined,
  Loader2,
  Mic,
  Target,
  Trophy,
} from "lucide-react";
import { BACKEND_URL } from "@/lib/config";
import { Button } from "./ui/button";

type Project = { id: string; name: string };
type Topic = {
  category: string;
  score: number;
  answers: number;
  kind: string;
  projectId: string;
  projectName?: string;
};
type Analytics = {
  projects: Project[];
  summary: {
    completedPracticeSessions: number;
    quizCount: number;
    quizAccuracy: number | null;
    evaluatedPracticeAnswers: number;
    averagePracticeScore: number | null;
    completedInterviews: number;
    averageInterviewScore: number | null;
    strongestTopic: Topic | null;
    weakestTopic: Topic | null;
  };
  topicPerformance: Topic[];
  interviewWeaknesses: Array<{ weakness: string; count: number }>;
  recommendations: Array<{
    category: string;
    projectId: string;
    reason: string;
    source: string;
  }>;
  activity: Array<{
    id: string;
    projectId: string;
    type: string;
    score: number | null;
    createdAt: string;
    label: string;
    projectName: string;
  }>;
};

const categories = [
  "Project Understanding",
  "Backend",
  "Frontend",
  "Database",
  "System Design",
  "AI/ML",
  "RAG",
  "APIs",
  "DevOps",
  "General Technical",
];

export function AnalyticsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    axios
      .get<Project[]>(BACKEND_URL + "/api/projects")
      .then(({ data: rows }) => setProjects(rows))
      .catch(() =>
        setError("Could not load projects. Check the backend connection."),
      );
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const query = projectId
      ? "?projectId=" + encodeURIComponent(projectId)
      : "";
    axios
      .get<Analytics>(BACKEND_URL + "/api/learning/analytics" + query)
      .then(({ data: result }) => {
        if (active) {
          setData(result);
        }
      })
      .catch((requestError) => {
        if (active)
          setError(
            axios.isAxiosError(requestError) &&
              requestError.response?.status === 404
              ? "That project no longer exists."
              : "Performance data could not be loaded. Please retry.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId, reload]);

  function practice(category: string, selectedProject = projectId) {
    const params = new URLSearchParams();
    if (categories.includes(category)) params.set("category", category);
    if (selectedProject) params.set("projectId", selectedProject);
    navigate("/practice?" + params.toString());
  }

  const summary = data?.summary;
  const score = (value: number | null | undefined, suffix = "/10") =>
    value == null ? "—" : String(value) + suffix;
  const trend = [...(data?.activity ?? [])]
    .reverse()
    .map((item, index, rows) => ({
      ...item,
      x: rows.length < 2 ? 50 : 8 + (index / (rows.length - 1)) * 84,
      normalizedScore:
        item.score == null
          ? 0
          : item.type === "QUIZ"
            ? item.score
            : item.score * 10,
    }));
  const trendPoints = trend
    .map((item) => `${item.x},${92 - item.normalizedScore * 0.78}`)
    .join(" ");
  const metrics = [
    {
      label: "Average practice score",
      value: score(summary?.averagePracticeScore),
      detail:
        String(summary?.evaluatedPracticeAnswers ?? 0) + " evaluated answers",
      icon: Brain,
    },
    {
      label: "Quiz accuracy",
      value: score(summary?.quizAccuracy, "%"),
      detail: String(summary?.quizCount ?? 0) + " completed quizzes",
      icon: BookOpenCheck,
    },
    {
      label: "Interview score",
      value: score(summary?.averageInterviewScore),
      detail:
        String(summary?.completedInterviews ?? 0) + " completed interviews",
      icon: Mic,
    },
    {
      label: "Practice sessions",
      value: String(summary?.completedPracticeSessions ?? 0),
      detail: "Completed sessions",
      icon: Target,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-primary">
            <ChartNoAxesCombined className="size-5" />
            <span className="text-sm font-medium">Learning progress</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Performance</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Review saved practice and interview results, then focus on the
            topics that need work.
          </p>
        </div>
        <label className="text-sm font-medium">
          Project
          <select
            aria-label="Analytics project"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            className="mt-2 h-10 min-w-56 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">All projects</option>
            {projects.map((project) => (
              <option value={project.id} key={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p
          role="alert"
          className="mb-5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}{" "}
          <button
            className="underline"
            onClick={() => setReload((value) => value + 1)}
          >
            Retry
          </button>
        </p>
      )}
      {loading ? (
        <div className="flex h-48 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 size-5 animate-spin" />
          Loading performance…
        </div>
      ) : (
        data && (
          <>
            <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {metrics.map(({ label, value, detail, icon: Icon }) => (
                <div className="rounded-xl border bg-card/70 p-5" key={label}>
                  <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="size-4 text-primary" />
                  </div>
                  <p className="text-2xl font-bold">{value}</p>
                  <p className="mt-0.5 text-sm font-medium">{label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
                </div>
              ))}
            </div>
            {(summary?.strongestTopic || summary?.weakestTopic) && (
              <div className="mb-8 grid gap-4 md:grid-cols-2">
                {summary.strongestTopic && (
                  <div className="flex gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
                    <Trophy className="size-5 text-emerald-500" />
                    <div>
                      <p className="text-sm font-medium">
                        Strongest area · {summary.strongestTopic.category}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {summary.strongestTopic.score}/10 across{" "}
                        {summary.strongestTopic.answers} evaluations.
                      </p>
                    </div>
                  </div>
                )}
                {summary.weakestTopic && (
                  <div className="flex gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-5">
                    <Target className="size-5 text-amber-500" />
                    <div>
                      <p className="text-sm font-medium">
                        Needs attention · {summary.weakestTopic.category} ·{" "}
                        {summary.weakestTopic.projectName}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {summary.weakestTopic.score}/10 average. Targeted
                        practice is ready.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-3"
                        onClick={() =>
                          practice(
                            summary.weakestTopic!.category,
                            summary.weakestTopic!.projectId,
                          )
                        }
                      >
                        Practice this area
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-xl border bg-card/50 p-5">
                <h2 className="text-lg font-semibold">Topic performance</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Scores from saved practice answers and interview sub-scores.
                </p>
                {!data.topicPerformance.length ? (
                  <p className="mt-5 rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
                    Complete practice answers or a project interview to
                    establish your first topic score.
                  </p>
                ) : (
                  <div className="mt-5 space-y-4">
                    {data.topicPerformance.map((topic, index) => (
                      <div
                        key={topic.projectId + topic.category + String(index)}
                      >
                        <div className="mb-1.5 flex justify-between text-sm">
                          <span>
                            {topic.category} · {topic.projectName}
                          </span>
                          <span className="text-muted-foreground">
                            {topic.score}/10 · {topic.answers}{" "}
                            {topic.kind === "practice"
                              ? "answers"
                              : "interviews"}
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className={
                              "h-full rounded-full " +
                              (topic.score >= 7
                                ? "bg-emerald-500"
                                : topic.score >= 5
                                  ? "bg-amber-500"
                                  : "bg-destructive")
                            }
                            style={{ width: topic.score * 10 + "%" }}
                          />
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="mt-1 h-7 px-2 text-xs"
                          onClick={() =>
                            practice(
                              categories.includes(topic.category)
                                ? topic.category
                                : "Project Understanding",
                              topic.projectId,
                            )
                          }
                        >
                          Practice {topic.category}
                          <ArrowRight className="ml-1 size-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              <section className="rounded-xl border bg-card/50 p-5">
                <h2 className="text-lg font-semibold">
                  Personalized next steps
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Prioritized from your observed scores and interview feedback.
                </p>
                {!data.recommendations.length ? (
                  <div className="mt-5 rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                    No weak areas identified yet. Complete practice answers or
                    project interviews to build recommendations.
                    <Button
                      className="mt-4"
                      size="sm"
                      onClick={() => practice("Project Understanding")}
                    >
                      Start a practice session
                    </Button>
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    {data.recommendations.map((item, index) => (
                      <div
                        className="rounded-lg border p-4"
                        key={item.category + String(index)}
                      >
                        <p className="font-medium">
                          {item.category} ·{" "}
                          {projects.find(
                            (project) => project.id === item.projectId,
                          )?.name ?? "Project"}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {item.reason}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-3"
                          onClick={() =>
                            practice(
                              categories.includes(item.category)
                                ? item.category
                                : "Project Understanding",
                              item.projectId,
                            )
                          }
                        >
                          Practice this topic
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                {!!data.interviewWeaknesses.length && (
                  <div className="mt-6 border-t pt-4">
                    <h3 className="text-sm font-medium">
                      Recurring interview feedback
                    </h3>
                    <ul className="mt-2 space-y-2">
                      {data.interviewWeaknesses.map((item) => (
                        <li
                          className="text-sm text-muted-foreground"
                          key={item.weakness}
                        >
                          {item.weakness} · {item.count} interview
                          {item.count === 1 ? "" : "s"}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            </div>
            <section className="mt-6 rounded-xl border bg-card/50 p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">
                    Recent learning activity
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Latest saved quiz, practice, and interview results.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate("/practice")}
                >
                  AI Practice
                </Button>
              </div>
              {trend.length > 0 && (
                <div className="mb-5 rounded-lg border bg-background/50 p-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-medium">Performance trend</h3>
                    <span className="text-xs text-muted-foreground">
                      Scores normalized to percent · oldest to newest
                    </span>
                  </div>
                  <svg
                    role="img"
                    aria-label="Performance trend from recent saved activities"
                    viewBox="0 0 100 100"
                    className="h-36 w-full overflow-visible"
                  >
                    {[20, 40, 60, 80].map((y) => (
                      <line
                        key={y}
                        x1="8"
                        x2="92"
                        y1={y}
                        y2={y}
                        stroke="currentColor"
                        className="text-border"
                        strokeDasharray="1 2"
                      />
                    ))}
                    {trend.length > 1 && (
                      <polyline
                        points={trendPoints}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        className="text-primary"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                    {trend.map((item) => (
                      <circle
                        key={item.id + item.type}
                        cx={item.x}
                        cy={92 - item.normalizedScore * 0.78}
                        r="2"
                        fill="currentColor"
                        className="text-primary"
                      >
                        <title>
                          {item.label}: {item.normalizedScore}%
                        </title>
                      </circle>
                    ))}
                  </svg>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      {new Date(trend[0]!.createdAt).toLocaleDateString()}
                    </span>
                    <span>
                      {new Date(
                        trend[trend.length - 1]!.createdAt,
                      ).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              )}
              {!data.activity.length ? (
                <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
                  Completed learning activities will appear here.
                </p>
              ) : (
                <div className="divide-y">
                  {data.activity.map((item) => (
                    <div
                      key={item.type + item.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      <div>
                        <p className="text-sm font-medium">{item.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.projectName} ·{" "}
                          {new Date(item.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium">
                          {item.score == null
                            ? "—"
                            : item.type === "QUIZ"
                              ? item.score + "%"
                              : item.score + "/10"}
                        </span>
                        {item.type === "PRACTICE" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              practice("Project Understanding", item.projectId)
                            }
                          >
                            Practice again
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )
      )}
    </div>
  );
}
