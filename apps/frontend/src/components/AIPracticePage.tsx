import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useSearchParams } from "react-router";
import {
  Brain,
  BookOpenCheck,
  MessageSquareText,
  Loader2,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import { BACKEND_URL } from "@/lib/config";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

type Project = {
  id: string;
  name: string;
  technologies: string[];
  documentCount: number;
};
type Mode = "quiz" | "interview" | "practice";
type Difficulty = "Easy" | "Medium" | "Hard";
type QuestionType = "MCQ" | "True/False" | "Mixed";
type Category =
  | "Project Understanding"
  | "Backend"
  | "Frontend"
  | "Database"
  | "System Design"
  | "AI/ML"
  | "RAG"
  | "APIs"
  | "DevOps"
  | "General Technical";
type QuizQuestion = {
  id: string;
  question: string;
  options: string[];
  difficulty: Difficulty;
  questionType: "MCQ" | "True/False";
};
type QuizResult = {
  score: number;
  total: number;
  results: Array<{
    id: string;
    question: string;
    selectedAnswer: string;
    correctAnswer: string;
    explanation: string;
    isCorrect: boolean;
  }>;
};
type Evaluation = {
  score: number;
  whatYouGotRight: string[];
  whatWasMissing: string[];
  howToImprove: string[];
  idealAnswer: string;
  questionNumber: number;
  totalQuestions: number;
};
type InterviewQuestion = { question: string; expectedAnswer: string };

const categories: Category[] = [
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

function ErrorMessage({ children }: { children: string }) {
  return (
    <p
      role="alert"
      className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {children}
    </p>
  );
}

function FeedbackList({ title, items }: { title: string; items: string[] }) {
  return (
    <section>
      <h4 className="mb-1 text-sm font-semibold">{title}</h4>
      {items.length ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {items.map((item, index) => (
            <li key={`${index}-${item}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing to add here.</p>
      )}
    </section>
  );
}

export function AIPracticePage() {
  const [searchParams] = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [mode, setMode] = useState<Mode>("quiz");
  const [difficulty, setDifficulty] = useState<Difficulty>("Medium");
  const [questionType, setQuestionType] = useState<QuestionType>("Mixed");
  const [category, setCategory] = useState<Category>(() => {
    const initial = searchParams.get("category");
    return categories.includes(initial as Category)
      ? (initial as Category)
      : "Project Understanding";
  });
  const [count, setCount] = useState(5);
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  const [quizId, setQuizId] = useState("");
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null);
  const [interviewQuestion, setInterviewQuestion] =
    useState<InterviewQuestion | null>(null);
  const [practiceId, setPracticeId] = useState("");
  const [practiceQuestion, setPracticeQuestion] = useState("");
  const [practiceQuestionNumber, setPracticeQuestionNumber] = useState(1);
  const [practiceAnswer, setPracticeAnswer] = useState("");
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [practiceComplete, setPracticeComplete] = useState(false);

  useEffect(() => {
    let active = true;
    axios
      .get<Project[]>(`${BACKEND_URL}/api/projects`)
      .then(({ data }) => {
        if (!active) return;
        setProjects(data);
        const requestedProjectId = searchParams.get("projectId");
        setProjectId(
          data.some((project) => project.id === requestedProjectId)
            ? requestedProjectId!
            : (data[0]?.id ?? ""),
        );
      })
      .catch(() => {
        if (active)
          setPageError(
            "Projects could not be loaded. Check that the backend is running and retry.",
          );
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId),
    [projects, projectId],
  );

  function clearResults(nextMode: Mode) {
    setMode(nextMode);
    setPageError("");
    setQuizId("");
    setQuizQuestions([]);
    setQuizAnswers({});
    setQuizResult(null);
    setInterviewQuestion(null);
    setPracticeId("");
    setPracticeQuestion("");
    setPracticeQuestionNumber(1);
    setPracticeAnswer("");
    setEvaluation(null);
    setPracticeComplete(false);
  }

  async function runRequest(action: () => Promise<void>) {
    setLoading(true);
    setPageError("");
    try {
      await action();
    } catch (error) {
      const responseError = axios.isAxiosError<{ error?: string }>(error)
        ? error.response?.data?.error
        : undefined;
      setPageError(responseError ?? "The AI request failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function generateQuiz() {
    await runRequest(async () => {
      const { data } = await axios.post(`${BACKEND_URL}/api/learning/quiz`, {
        projectId,
        count,
        difficulty,
        questionType,
      });
      setQuizId(data.sessionId);
      setQuizQuestions(data.questions);
      setQuizAnswers({});
      setQuizResult(null);
    });
  }

  async function submitQuiz() {
    if (quizQuestions.some((question) => !quizAnswers[question.id])) {
      setPageError("Answer every question before submitting the quiz.");
      return;
    }
    await runRequest(async () => {
      const { data } = await axios.post<QuizResult>(
        `${BACKEND_URL}/api/learning/quiz/${quizId}/submit`,
        {
          answers: quizQuestions.map(({ id }) => ({
            questionId: id,
            answer: quizAnswers[id]!,
          })),
        },
      );
      setQuizResult(data);
    });
  }

  async function generateInterviewQuestion() {
    await runRequest(async () => {
      const { data } = await axios.post<InterviewQuestion>(
        `${BACKEND_URL}/api/learning/interview-question`,
        {
          projectId,
          category,
          difficulty,
        },
      );
      setInterviewQuestion(data);
    });
  }

  async function startPractice() {
    await runRequest(async () => {
      const { data } = await axios.post(
        `${BACKEND_URL}/api/learning/practice`,
        {
          projectId,
          category,
          difficulty,
          count,
        },
      );
      setPracticeId(data.sessionId);
      setPracticeQuestion(data.question);
      setPracticeQuestionNumber(data.questionNumber);
      setEvaluation(null);
      setPracticeAnswer("");
      setPracticeComplete(false);
    });
  }

  async function submitPracticeAnswer() {
    await runRequest(async () => {
      const { data } = await axios.post<Evaluation>(
        `${BACKEND_URL}/api/learning/practice/${practiceId}/answer`,
        { answer: practiceAnswer },
      );
      setEvaluation(data);
    });
  }

  async function nextPracticeQuestion() {
    await runRequest(async () => {
      const { data } = await axios.post(
        `${BACKEND_URL}/api/learning/practice/${practiceId}/next`,
      );
      if (data.completed) {
        setPracticeComplete(true);
        return;
      }
      setPracticeQuestion(data.question);
      setPracticeQuestionNumber(data.questionNumber);
      setPracticeAnswer("");
      setEvaluation(null);
    });
  }

  const tabs: Array<{
    id: Mode;
    title: string;
    description: string;
    icon: typeof Brain;
  }> = [
    {
      id: "quiz",
      title: "Generate Quiz",
      description: "Check your knowledge with grounded questions",
      icon: BookOpenCheck,
    },
    {
      id: "interview",
      title: "Interview Q&A",
      description: "Explore a question and a model answer",
      icon: MessageSquareText,
    },
    {
      id: "practice",
      title: "Ask Me",
      description: "Answer one question at a time and get feedback",
      icon: Brain,
    },
  ];

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8">
        <div className="mb-2 flex items-center gap-2 text-primary">
          <Brain className="size-5" />
          <span className="text-sm font-medium">AI-powered learning</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">AI Practice</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Practice with questions grounded in your project documents and
          implementation.
        </p>
      </div>

      <div className="mb-6 grid gap-3 md:grid-cols-3">
        {tabs.map(({ id, title, description, icon: Icon }) => (
          <button
            key={id}
            onClick={() => clearResults(id)}
            className={`rounded-xl border p-4 text-left transition-colors ${mode === id ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-accent/40"}`}
          >
            <Icon className="mb-3 size-5 text-primary" />
            <span className="block font-medium">{title}</span>
            <span className="mt-1 block text-sm text-muted-foreground">
              {description}
            </span>
          </button>
        ))}
      </div>

      <div className="mb-6 rounded-xl border bg-card p-5">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-medium">
            Project knowledge
            <select
              value={projectId}
              onChange={(event) => {
                setProjectId(event.target.value);
                clearResults(mode);
              }}
              className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              disabled={!projects.length}
            >
              {projects.length === 0 ? (
                <option value="">No projects available</option>
              ) : (
                projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="text-sm font-medium">
            Difficulty
            <select
              value={difficulty}
              onChange={(event) =>
                setDifficulty(event.target.value as Difficulty)
              }
              className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {(["Easy", "Medium", "Hard"] as const).map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          {mode === "quiz" ? (
            <label className="text-sm font-medium">
              Question type
              <select
                value={questionType}
                onChange={(event) =>
                  setQuestionType(event.target.value as QuestionType)
                }
                className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {(["MCQ", "True/False", "Mixed"] as const).map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          ) : (
            <label className="text-sm font-medium">
              Interview category
              <select
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as Category)
                }
                className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {categories.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          )}
          {mode !== "interview" && (
            <label className="text-sm font-medium">
              Number of questions
              <select
                value={count}
                onChange={(event) => setCount(Number(event.target.value))}
                className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {[1, 3, 5, 10, 15].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {selectedProject && (
          <p className="mt-3 text-xs text-muted-foreground">
            Using {selectedProject.name} · {selectedProject.documentCount}{" "}
            document{selectedProject.documentCount === 1 ? "" : "s"}. Only
            processed project knowledge is used.
          </p>
        )}
      </div>

      {pageError && (
        <div className="mb-5">
          <ErrorMessage>{pageError}</ErrorMessage>
        </div>
      )}
      {projects.length === 0 && (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Create a project and process a document before starting AI practice.
        </div>
      )}

      {projects.length > 0 && mode === "quiz" && (
        <section className="space-y-5">
          {!quizQuestions.length && (
            <Button onClick={generateQuiz} disabled={loading || !projectId}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Creating quiz…
                </>
              ) : (
                <>
                  Generate Quiz <ArrowRight className="ml-2 size-4" />
                </>
              )}
            </Button>
          )}
          {quizQuestions.map((question, index) => {
            const result = quizResult?.results.find(
              (item) => item.id === question.id,
            );
            return (
              <div key={question.id} className="rounded-xl border bg-card p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Question {index + 1} · {question.difficulty} ·{" "}
                    {question.questionType}
                  </span>
                  {result &&
                    (result.isCorrect ? (
                      <CheckCircle2 className="size-4 text-emerald-500" />
                    ) : null)}
                </div>
                <h2 className="mb-4 font-medium">{question.question}</h2>
                <div className="space-y-2">
                  {question.options.map((option, optionIndex) => {
                    const value =
                      question.questionType === "MCQ"
                        ? String.fromCharCode(65 + optionIndex)
                        : option;
                    return (
                      <label
                        key={option}
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${quizAnswers[question.id] === value ? "border-primary bg-primary/5" : "border-border"}`}
                      >
                        <input
                          type="radio"
                          name={question.id}
                          value={value}
                          checked={quizAnswers[question.id] === value}
                          disabled={Boolean(quizResult)}
                          onChange={() =>
                            setQuizAnswers((previous) => ({
                              ...previous,
                              [question.id]: value,
                            }))
                          }
                        />
                        <span>{option}</span>
                      </label>
                    );
                  })}
                </div>
                {result && (
                  <div className="mt-4 rounded-lg bg-muted/60 p-3 text-sm">
                    <p>
                      <strong>
                        {result.isCorrect
                          ? "Correct"
                          : `Correct answer: ${result.correctAnswer}`}
                      </strong>
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {result.explanation}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
          {!!quizQuestions.length && !quizResult && (
            <Button onClick={submitQuiz} disabled={loading}>
              {loading ? "Checking answers…" : "Submit quiz"}
            </Button>
          )}
          {quizResult && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
              <p className="text-lg font-semibold">
                Your score: {quizResult.score} / {quizResult.total}
              </p>
              <Button
                variant="outline"
                className="mt-3"
                onClick={() => {
                  setQuizQuestions([]);
                  setQuizId("");
                  setQuizAnswers({});
                  setQuizResult(null);
                }}
              >
                Create another quiz
              </Button>
            </div>
          )}
        </section>
      )}

      {projects.length > 0 && mode === "interview" && (
        <section className="space-y-5">
          {!interviewQuestion && (
            <Button
              onClick={generateInterviewQuestion}
              disabled={loading || !projectId}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Generating…
                </>
              ) : (
                "Generate interview question"
              )}
            </Button>
          )}
          {interviewQuestion && (
            <div className="rounded-xl border bg-card p-6">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {category} · {difficulty}
              </p>
              <h2 className="text-xl font-semibold">
                {interviewQuestion.question}
              </h2>
              <div className="mt-6 rounded-lg bg-muted/50 p-4">
                <h3 className="mb-2 font-medium">Model answer</h3>
                <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                  {interviewQuestion.expectedAnswer}
                </p>
              </div>
              <Button
                variant="outline"
                className="mt-5"
                onClick={generateInterviewQuestion}
                disabled={loading}
              >
                {loading ? "Generating…" : "Generate another"}
              </Button>
            </div>
          )}
        </section>
      )}

      {projects.length > 0 && mode === "practice" && (
        <section className="space-y-5">
          {!practiceId && (
            <Button onClick={startPractice} disabled={loading || !projectId}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Preparing practice…
                </>
              ) : (
                <>
                  Start practice <ArrowRight className="ml-2 size-4" />
                </>
              )}
            </Button>
          )}
          {practiceComplete && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6">
              <h2 className="text-xl font-semibold">Practice complete</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                You finished all {count} questions. Nice work.
              </p>
              <Button
                className="mt-4"
                variant="outline"
                onClick={() => {
                  setPracticeId("");
                  setPracticeComplete(false);
                  setEvaluation(null);
                }}
              >
                Start another session
              </Button>
            </div>
          )}
          {practiceId && !practiceComplete && (
            <div className="rounded-xl border bg-card p-6">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Question {practiceQuestionNumber} of{" "}
                {evaluation?.totalQuestions ?? count} · {category} ·{" "}
                {difficulty}
              </p>
              <h2 className="text-xl font-semibold">{practiceQuestion}</h2>
              {!evaluation ? (
                <div className="mt-5 space-y-3">
                  <Textarea
                    value={practiceAnswer}
                    onChange={(event) => setPracticeAnswer(event.target.value)}
                    placeholder="Type your interview answer…"
                    rows={5}
                    disabled={loading}
                  />
                  <Button
                    onClick={submitPracticeAnswer}
                    disabled={loading || !practiceAnswer.trim()}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        Evaluating…
                      </>
                    ) : (
                      "Submit answer"
                    )}
                  </Button>
                </div>
              ) : (
                <div className="mt-6 space-y-5">
                  <p className="text-lg font-semibold">
                    Score: {evaluation.score}/10
                  </p>
                  <div className="grid gap-4 md:grid-cols-3">
                    <FeedbackList
                      title="What you got right"
                      items={evaluation.whatYouGotRight}
                    />
                    <FeedbackList
                      title="What was missing"
                      items={evaluation.whatWasMissing}
                    />
                    <FeedbackList
                      title="How to improve"
                      items={evaluation.howToImprove}
                    />
                  </div>
                  <div className="rounded-lg bg-muted/50 p-4">
                    <h3 className="mb-2 font-medium">Ideal interview answer</h3>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                      {evaluation.idealAnswer}
                    </p>
                  </div>
                  <Button onClick={nextPracticeQuestion} disabled={loading}>
                    {loading
                      ? "Preparing next question…"
                      : evaluation.questionNumber === evaluation.totalQuestions
                        ? "Finish practice"
                        : "Next question"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
