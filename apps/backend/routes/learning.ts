import { Router, type Response } from "express";
import { z } from "zod";
import {
  LearningSessionKind,
  LearningSessionStatus,
} from "../generated/prisma/client";
import { prisma } from "../db";
import { retrieveForProject } from "../knowledge-retrieval";
import {
  DifficultySchema,
  InterviewCategorySchema,
  PracticeSettingsSchema,
  QuizSettingsSchema,
  assertPracticeCanContinue,
  assertProjectHasKnowledge,
  evaluatePracticeAnswer,
  generateInterviewQuestion,
  generateQuiz,
  isQuizAnswerCorrect,
  type GeneratedQuizQuestion,
} from "../learning-service";

const router = Router();
const interviewRequestSchema = z.object({
  projectId: z.string().uuid(),
  category: InterviewCategorySchema,
  difficulty: DifficultySchema,
});
const quizAnswerRequestSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().uuid(),
        answer: z.string().min(1).max(1000),
      }),
    )
    .min(1)
    .max(15),
});
const practiceAnswerRequestSchema = z.object({
  answer: z.string().trim().min(1).max(10000),
});

const practiceStateSchema = z.object({
  difficulty: DifficultySchema,
  category: InterviewCategorySchema,
  totalQuestions: z.number().int().positive(),
  questionNumber: z.number().int().positive(),
  question: z.string(),
  expectedAnswer: z.string(),
  evaluation: z
    .object({
      score: z.number().int().min(0).max(10),
      whatYouGotRight: z.array(z.string()),
      whatWasMissing: z.array(z.string()),
      howToImprove: z.array(z.string()),
      idealAnswer: z.string(),
    })
    .nullable(),
  previousQuestions: z.array(z.string()),
});

type ProjectInfo = {
  id: string;
  name: string;
  description: string | null;
  technologies: string[];
};

async function loadProject(projectId: string): Promise<ProjectInfo> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      description: true,
      technologies: true,
      documents: {
        where: { processingStatus: "PROCESSED" },
        select: { id: true },
        take: 1,
      },
    },
  });
  assertProjectHasKnowledge(
    Boolean(project),
    Boolean(project?.documents.length),
  );
  if (!project) throw new Error("Project not found");
  return project;
}

async function retrieveProjectContext(project: ProjectInfo, query: string) {
  const chunks = await retrieveForProject(project.id, query, 6);
  if (!chunks.length) {
    throw Object.assign(
      new Error("No searchable project context was found for this topic."),
      {
        status: 400,
      },
    );
  }
  return chunks;
}

function handleError(res: Response, error: unknown) {
  const status =
    error instanceof Error &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : 502;
  if (status >= 500) console.error("[learning] Request failed:", error);
  res.status(status).json({
    error:
      status === 502
        ? "AI learning request failed. Please try again."
        : (error as Error).message,
  });
}

function publicQuizQuestion(question: GeneratedQuizQuestion) {
  return {
    id: question.id,
    question: question.question,
    options: question.options,
    difficulty: question.difficulty,
    questionType: question.questionType,
  };
}

router.post("/quiz", async (req, res) => {
  const parsed = QuizSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid quiz settings", details: parsed.error.issues });
    return;
  }
  try {
    const project = await loadProject(parsed.data.projectId);
    const query = `${project.name} ${project.description ?? ""} ${project.technologies.join(" ")} project implementation details`;
    const chunks = await retrieveProjectContext(project, query);
    const questions = await generateQuiz({
      ...parsed.data,
      projectName: project.name,
      technologies: project.technologies,
      chunks,
    });
    const session = await prisma.learningSession.create({
      data: {
        projectId: project.id,
        kind: LearningSessionKind.QUIZ,
        state: {
          questions,
          difficulty: parsed.data.difficulty,
          questionType: parsed.data.questionType,
        },
      },
    });
    res.status(201).json({
      sessionId: session.id,
      projectName: project.name,
      questions: questions.map(publicQuizQuestion),
    });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/quiz/:sessionId/submit", async (req, res) => {
  const params = z.string().uuid().safeParse(req.params.sessionId);
  const parsed = quizAnswerRequestSchema.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid quiz submission" });
    return;
  }
  try {
    const session = await prisma.learningSession.findUnique({
      where: { id: params.data },
    });
    if (!session || session.kind !== LearningSessionKind.QUIZ) {
      res.status(404).json({ error: "Quiz not found" });
      return;
    }
    if (session.status !== LearningSessionStatus.ACTIVE) {
      res.status(409).json({ error: "Quiz has already been submitted" });
      return;
    }
    const state = z
      .object({
        questions: z.array(
          z.object({
            id: z.string().uuid(),
            question: z.string(),
            options: z.array(z.string()),
            correctAnswer: z.string(),
            explanation: z.string(),
            difficulty: DifficultySchema,
            questionType: z.enum(["MCQ", "True/False"]),
          }),
        ),
      })
      .parse(session.state);
    const byId = new Map(
      parsed.data.answers.map((answer) => [answer.questionId, answer.answer]),
    );
    if (
      byId.size !== state.questions.length ||
      state.questions.some((question) => !byId.has(question.id))
    ) {
      res
        .status(400)
        .json({ error: "Submit one answer for every quiz question" });
      return;
    }
    const results = state.questions.map((question) => {
      const selectedAnswer = byId.get(question.id)!;
      const isCorrect = isQuizAnswerCorrect(
        question.correctAnswer,
        selectedAnswer,
      );
      return {
        id: question.id,
        question: question.question,
        selectedAnswer,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
        isCorrect,
      };
    });
    const score = results.filter((result) => result.isCorrect).length;
    await prisma.learningSession.update({
      where: { id: session.id },
      data: {
        status: LearningSessionStatus.COMPLETED,
        answers: results,
      },
    });
    res.json({ score, total: results.length, results });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/interview-question", async (req, res) => {
  const parsed = interviewRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid interview question settings",
      details: parsed.error.issues,
    });
    return;
  }
  try {
    const project = await loadProject(parsed.data.projectId);
    const chunks = await retrieveProjectContext(
      project,
      `${project.name} ${parsed.data.category} ${parsed.data.difficulty} project implementation`,
    );
    const result = await generateInterviewQuestion({
      ...parsed.data,
      projectName: project.name,
      technologies: project.technologies,
      chunks,
    });
    res.json(result);
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/practice", async (req, res) => {
  const parsed = PracticeSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid practice settings",
      details: parsed.error.issues,
    });
    return;
  }
  try {
    const project = await loadProject(parsed.data.projectId);
    const chunks = await retrieveProjectContext(
      project,
      `${project.name} ${parsed.data.category} ${parsed.data.difficulty} project interview question`,
    );
    const { question, expectedAnswer } = await generateInterviewQuestion({
      ...parsed.data,
      projectName: project.name,
      technologies: project.technologies,
      chunks,
    });
    const state = {
      difficulty: parsed.data.difficulty,
      category: parsed.data.category,
      totalQuestions: parsed.data.count,
      questionNumber: 1,
      question,
      expectedAnswer,
      evaluation: null,
      previousQuestions: [question],
    };
    const session = await prisma.learningSession.create({
      data: {
        projectId: project.id,
        kind: LearningSessionKind.PRACTICE,
        state,
        answers: [],
      },
    });
    res.status(201).json({
      sessionId: session.id,
      questionNumber: 1,
      totalQuestions: parsed.data.count,
      question,
    });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/practice/:sessionId/answer", async (req, res) => {
  const params = z.string().uuid().safeParse(req.params.sessionId);
  const parsed = practiceAnswerRequestSchema.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "A non-empty answer is required" });
    return;
  }
  try {
    const session = await prisma.learningSession.findUnique({
      where: { id: params.data },
      include: { project: true },
    });
    if (!session || session.kind !== LearningSessionKind.PRACTICE) {
      res.status(404).json({ error: "Practice session not found" });
      return;
    }
    if (session.status !== LearningSessionStatus.ACTIVE) {
      res.status(409).json({ error: "Practice session is complete" });
      return;
    }
    const state = practiceStateSchema.parse(session.state);
    if (state.evaluation) {
      res.json({
        ...state.evaluation,
        questionNumber: state.questionNumber,
        totalQuestions: state.totalQuestions,
      });
      return;
    }
    const chunks = await retrieveForProject(
      session.projectId,
      `${state.category} ${state.question} ${parsed.data.answer}`,
      6,
    );
    const evaluation = await evaluatePracticeAnswer({
      question: state.question,
      expectedAnswer: state.expectedAnswer,
      userAnswer: parsed.data.answer,
      chunks,
    });
    const nextState = { ...state, evaluation };
    const priorAnswers = Array.isArray(session.answers) ? session.answers : [];
    await prisma.learningSession.update({
      where: { id: session.id },
      data: {
        state: nextState,
        answers: [
          ...priorAnswers,
          { question: state.question, answer: parsed.data.answer, evaluation },
        ],
      },
    });
    res.json({
      ...evaluation,
      questionNumber: state.questionNumber,
      totalQuestions: state.totalQuestions,
    });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/practice/:sessionId/next", async (req, res) => {
  const params = z.string().uuid().safeParse(req.params.sessionId);
  if (!params.success) {
    res.status(400).json({ error: "Invalid practice session ID" });
    return;
  }
  try {
    const session = await prisma.learningSession.findUnique({
      where: { id: params.data },
      include: { project: true },
    });
    if (!session || session.kind !== LearningSessionKind.PRACTICE) {
      res.status(404).json({ error: "Practice session not found" });
      return;
    }
    const state = practiceStateSchema.parse(session.state);
    try {
      assertPracticeCanContinue(session.status, Boolean(state.evaluation));
    } catch (error) {
      handleError(res, error);
      return;
    }
    if (state.questionNumber >= state.totalQuestions) {
      await prisma.learningSession.update({
        where: { id: session.id },
        data: { status: LearningSessionStatus.COMPLETED },
      });
      res.json({ completed: true });
      return;
    }
    const nextNumber = state.questionNumber + 1;
    const query = `${state.category} ${state.difficulty} project interview question ${state.previousQuestions.join(" ")}`;
    const chunks = await retrieveForProject(session.projectId, query, 6);
    if (!chunks.length) {
      res.status(400).json({
        error: "No searchable project context was found for this topic.",
      });
      return;
    }
    const generated = await generateInterviewQuestion({
      category: state.category,
      difficulty: state.difficulty,
      projectName: session.project.name,
      technologies: session.project.technologies,
      chunks,
    });
    const nextState = {
      ...state,
      questionNumber: nextNumber,
      question: generated.question,
      expectedAnswer: generated.expectedAnswer,
      evaluation: null,
      previousQuestions: [...state.previousQuestions, generated.question],
    };
    await prisma.learningSession.update({
      where: { id: session.id },
      data: { state: nextState },
    });
    res.json({
      completed: false,
      questionNumber: nextNumber,
      totalQuestions: state.totalQuestions,
      question: generated.question,
    });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/analytics", async (req, res) => {
  const projectId = req.query.projectId;
  if (
    projectId !== undefined &&
    (typeof projectId !== "string" ||
      !z.string().uuid().safeParse(projectId).success)
  ) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }
  try {
    const where = typeof projectId === "string" ? { projectId } : {};
    const [projects, sessions, interviews] = await Promise.all([
      prisma.project.findMany({
        select: { id: true, name: true },
      }),
      prisma.learningSession.findMany({
        where,
        select: {
          id: true,
          projectId: true,
          kind: true,
          status: true,
          state: true,
          answers: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.interview.findMany({
        where: {
          ...(typeof projectId === "string" ? { projectId } : {}),
          status: "Done",
          score: { not: null },
        },
        select: {
          id: true,
          projectId: true,
          interviewType: true,
          score: true,
          subScores: true,
          weaknesses: true,
          adaptiveState: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    if (
      typeof projectId === "string" &&
      !projects.some((project) => project.id === projectId)
    ) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const practice = sessions.filter(
      (session) => session.kind === LearningSessionKind.PRACTICE,
    );
    const quizzes = sessions.filter(
      (session) =>
        session.kind === LearningSessionKind.QUIZ &&
        session.status === LearningSessionStatus.COMPLETED,
    );
    const categoryScores = new Map<
      string,
      { total: number; count: number; answers: number; projectId: string }
    >();
    const recentActivity: Array<{
      id: string;
      projectId: string;
      type: string;
      score: number | null;
      createdAt: Date;
      label: string;
    }> = [];
    let practiceScoreTotal = 0;
    let practiceEvaluations = 0;
    for (const session of practice) {
      const state = practiceStateSchema.safeParse(session.state);
      const answers = z
        .array(
          z.object({
            question: z.string(),
            answer: z.string(),
            evaluation: z.object({
              score: z.number().min(0).max(10),
              whatYouGotRight: z.array(z.string()).default([]),
              whatWasMissing: z.array(z.string()).default([]),
              howToImprove: z.array(z.string()).default([]),
              idealAnswer: z.string().default(""),
            }),
          }),
        )
        .safeParse(session.answers);
      if (!state.success || !answers.success) continue;
      const category = state.data.category;
      const categoryKey = `${session.projectId}:${category}`;
      const bucket = categoryScores.get(categoryKey) ?? {
        total: 0,
        count: 0,
        answers: 0,
        projectId: session.projectId,
      };
      for (const entry of answers.data) {
        bucket.total += entry.evaluation.score;
        bucket.count += 1;
        bucket.answers += 1;
        practiceScoreTotal += entry.evaluation.score;
        practiceEvaluations += 1;
      }
      categoryScores.set(categoryKey, bucket);
      if (answers.data.length > 0) {
        const average =
          answers.data.reduce((sum, entry) => sum + entry.evaluation.score, 0) /
          answers.data.length;
        recentActivity.push({
          id: session.id,
          projectId: session.projectId,
          type: "PRACTICE",
          score: Math.round(average * 10) / 10,
          createdAt: session.createdAt,
          label: `${category} practice`,
        });
      }
    }

    let quizCorrect = 0;
    let quizTotal = 0;
    for (const session of quizzes) {
      const answers = z
        .array(z.object({ isCorrect: z.boolean() }))
        .safeParse(session.answers);
      if (!answers.success) continue;
      quizCorrect += answers.data.filter((answer) => answer.isCorrect).length;
      quizTotal += answers.data.length;
      if (answers.data.length > 0) {
        recentActivity.push({
          id: session.id,
          projectId: session.projectId,
          type: "QUIZ",
          score: Math.round(
            (answers.data.filter((answer) => answer.isCorrect).length /
              answers.data.length) *
              100,
          ),
          createdAt: session.createdAt,
          label: "Knowledge quiz",
        });
      }
    }

    const projectNames = new Map(
      projects.map((project) => [project.id, project.name]),
    );
    const interviewScores: number[] = [];
    const interviewWeaknesses = new Map<string, number>();
    const interviewSubScores: Record<
      string,
      { total: number; count: number; projectId: string }
    > = {};
    const adaptiveTopicScores: Record<
      string,
      { total: number; count: number; projectId: string; category: string }
    > = {};
    for (const interview of interviews) {
      const score = interview.score ?? 0;
      interviewScores.push(score);
      const weak = Array.isArray(interview.weaknesses)
        ? interview.weaknesses
        : [];
      for (const item of weak)
        interviewWeaknesses.set(item, (interviewWeaknesses.get(item) ?? 0) + 1);
      if (
        interview.subScores &&
        typeof interview.subScores === "object" &&
        !Array.isArray(interview.subScores)
      ) {
        for (const [key, value] of Object.entries(interview.subScores)) {
          if (typeof value !== "number") continue;
          if (!interview.projectId) continue;
          const subScoreKey = `${interview.projectId}:${key}`;
          const bucket = interviewSubScores[subScoreKey] ?? {
            total: 0,
            count: 0,
            projectId: interview.projectId,
          };
          bucket.total += value;
          bucket.count += 1;
          interviewSubScores[subScoreKey] = bucket;
        }
      }
      const adaptiveState = z
        .object({
          topicScores: z.array(
            z.object({
              topic: z.string().trim().min(1),
              scores: z.array(z.number().min(0).max(10)),
            }),
          ),
        })
        .safeParse(interview.adaptiveState);
      if (adaptiveState.success) {
        for (const topicScore of adaptiveState.data.topicScores) {
          if (topicScore.scores.length === 0) continue;
          const topicKey = `${interview.projectId ?? ""}:${topicScore.topic}`;
          const bucket = adaptiveTopicScores[topicKey] ?? {
            total: 0,
            count: 0,
            projectId: interview.projectId ?? "",
            category: topicScore.topic,
          };
          for (const answerScore of topicScore.scores) {
            bucket.total += answerScore;
            bucket.count += 1;
          }
          adaptiveTopicScores[topicKey] = bucket;
        }
      }
      recentActivity.push({
        id: interview.id,
        projectId: interview.projectId ?? "",
        type: "INTERVIEW",
        score,
        createdAt: interview.createdAt,
        label: `${interview.interviewType} interview`,
      });
    }

    const topicPerformance = [...categoryScores.entries()].map(
      ([key, value]) => ({
        category: key.slice(key.indexOf(":") + 1),
        score: Math.round((value.total / value.count) * 10) / 10,
        answers: value.answers,
        kind: "practice" as const,
        projectId: value.projectId,
      }),
    );
    const weakInterviewTopics = Object.entries(interviewSubScores)
      .filter(([, value]) => value.count > 0)
      .map(([key, value]) => ({
        category:
          (
            {
              architectureUnderstanding: "Project Understanding",
              technologyDecisions: "General Technical",
              implementationKnowledge: "Backend",
              databaseKnowledge: "Database",
              scalingKnowledge: "System Design",
              securityKnowledge: "Backend",
              tradeoffUnderstanding: "System Design",
            } as Record<string, string>
          )[key.slice(key.indexOf(":") + 1)] ?? "Project Understanding",
        score: Math.round((value.total / value.count) * 10) / 10,
        answers: value.count,
        kind: "interview" as const,
        projectId: value.projectId,
      }));
    const adaptiveInterviewTopics = Object.values(adaptiveTopicScores)
      .filter((value) => value.count > 0)
      .map((value) => ({
        category: value.category,
        score: Math.round((value.total / value.count) * 10) / 10,
        answers: value.count,
        kind: "interview" as const,
        projectId: value.projectId,
      }));
    const recommendations = [
      ...topicPerformance
        .filter((item) => item.score < 7)
        .map((item) => ({
          category: item.category,
          projectId: item.projectId,
          reason: `Your average score is ${item.score}/10 across ${item.answers} evaluated answer${item.answers === 1 ? "" : "s"}.`,
          source: "practice" as const,
        })),
      ...weakInterviewTopics
        .filter((item) => item.score < 6)
        .map((item) => ({
          category: item.category,
          projectId: item.projectId,
          reason: `Your interview evaluation averaged ${item.score}/10 in this area.`,
          source: "interview" as const,
        })),
      ...adaptiveInterviewTopics
        .filter((item) => item.score < 7)
        .map((item) => ({
          category: item.category,
          projectId: item.projectId,
          reason: `Your adaptive interview answers averaged ${item.score}/10 across ${item.answers} answer${item.answers === 1 ? "" : "s"}.`,
          source: "interview" as const,
        })),
    ]
      .sort((left, right) => {
        const leftScore =
          (left.source === "practice"
            ? topicPerformance
            : [...weakInterviewTopics, ...adaptiveInterviewTopics]
          ).find(
            (item) =>
              item.category === left.category &&
              item.projectId === left.projectId,
          )?.score ?? 0;
        const rightScore =
          (right.source === "practice"
            ? topicPerformance
            : [...weakInterviewTopics, ...adaptiveInterviewTopics]
          ).find(
            (item) =>
              item.category === right.category &&
              item.projectId === right.projectId,
          )?.score ?? 0;
        return leftScore - rightScore;
      })
      .slice(0, 5);

    const activity = recentActivity
      .sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
      )
      .slice(0, 12)
      .map((item) => ({
        ...item,
        projectName: projectNames.get(item.projectId) ?? "General interview",
      }));
    const completedQuestions = practiceEvaluations;
    const averagePracticeScore = practiceEvaluations
      ? Math.round((practiceScoreTotal / practiceEvaluations) * 10) / 10
      : null;
    const averageInterviewScore = interviewScores.length
      ? Math.round(
          (interviewScores.reduce((sum, score) => sum + score, 0) /
            interviewScores.length) *
            10,
        ) / 10
      : null;
    const allTopics = [
      ...topicPerformance,
      ...weakInterviewTopics,
      ...adaptiveInterviewTopics,
    ];
    const strongestTopic =
      allTopics
        .filter((item) => item.answers > 0)
        .sort((left, right) => right.score - left.score)[0] ?? null;
    const weakestTopic =
      allTopics
        .filter((item) => item.answers > 0)
        .sort((left, right) => left.score - right.score)[0] ?? null;

    res.json({
      projects,
      summary: {
        completedPracticeSessions: practice.filter(
          (session) => session.status === LearningSessionStatus.COMPLETED,
        ).length,
        quizCount: quizzes.length,
        quizAccuracy: quizTotal
          ? Math.round((quizCorrect / quizTotal) * 100)
          : null,
        evaluatedPracticeAnswers: completedQuestions,
        averagePracticeScore,
        completedInterviews: interviews.length,
        averageInterviewScore,
        strongestTopic,
        weakestTopic,
      },
      topicPerformance: [
        ...topicPerformance,
        ...weakInterviewTopics,
        ...adaptiveInterviewTopics,
      ].map((item) => ({
        ...item,
        projectName: projectNames.get(item.projectId) ?? "Project",
      })),
      interviewWeaknesses: [...interviewWeaknesses.entries()]
        .map(([weakness, count]) => ({ weakness, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6),
      recommendations,
      activity,
    });
  } catch (error) {
    handleError(res, error);
  }
});

export default router;
