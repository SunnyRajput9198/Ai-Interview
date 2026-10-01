import { describe, expect, test } from "bun:test";
import {
  AnswerEvaluationSchema,
  DifficultySchema,
  PracticeSettingsSchema,
  QuizSettingsSchema,
  assertPracticeCanContinue,
  assertProjectHasKnowledge,
  evaluatePracticeAnswer,
  generateInterviewQuestion,
  generateQuiz,
  isQuizAnswerCorrect,
  parseModelJson,
} from "./learning-service";

const projectChunks = [
  {
    documentId: "doc-1",
    documentName: "architecture.md",
    chunkIndex: 0,
    content:
      "The application stores 1536-dimensional text embeddings in PostgreSQL using pgvector for similarity retrieval.",
  },
];

describe("AI learning generation", () => {
  test("generates quiz questions grounded in retrieved project context", async () => {
    let promptSent = "";
    const questions = await generateQuiz(
      {
        count: 1,
        difficulty: "Medium",
        questionType: "MCQ",
        projectName: "InterviewForge",
        technologies: ["PostgreSQL", "pgvector"],
        chunks: projectChunks,
      },
      async (prompt) => {
        promptSent = prompt;
        return JSON.stringify({
          questions: [
            {
              question: "Why does the project use pgvector?",
              options: [
                "A) Similarity search",
                "B) Authentication",
                "C) File storage",
                "D) UI rendering",
              ],
              correctAnswer: "A",
              explanation:
                "The project stores embeddings and retrieves similar chunks.",
              difficulty: "Medium",
              questionType: "MCQ",
            },
          ],
        });
      },
    );
    expect(promptSent).toContain("1536-dimensional text embeddings");
    expect(questions).toHaveLength(1);
    expect(questions[0]?.correctAnswer).toBe("A");
    expect(questions[0]?.id).toBeString();
  });

  test("rejects malformed AI JSON and invalid quiz answer keys", async () => {
    expect(() => parseModelJson("not json", AnswerEvaluationSchema)).toThrow(
      "malformed JSON",
    );
    await expect(
      generateQuiz(
        {
          count: 1,
          difficulty: "Easy",
          questionType: "MCQ",
          projectName: "P",
          technologies: [],
          chunks: projectChunks,
        },
        async () =>
          JSON.stringify({
            questions: [
              {
                question: "Why use vector search in this project?",
                options: ["A", "B", "C", "D"],
                correctAnswer: "Z",
                explanation: "Because",
                difficulty: "Easy",
                questionType: "MCQ",
              },
            ],
          }),
      ),
    ).rejects.toThrow("invalid correct answer");
  });

  test("rejects wrong output count and invalid question settings", async () => {
    await expect(
      generateQuiz(
        {
          count: 2,
          difficulty: "Easy",
          questionType: "MCQ",
          projectName: "P",
          technologies: [],
          chunks: projectChunks,
        },
        async () => JSON.stringify({ questions: [] }),
      ),
    ).rejects.toThrow("unexpected number");
    expect(
      QuizSettingsSchema.safeParse({
        projectId: "bad",
        count: 0,
        difficulty: "Impossible",
        questionType: "MCQ",
      }).success,
    ).toBe(false);
    expect(
      PracticeSettingsSchema.safeParse({
        projectId: "not-a-uuid",
        count: 21,
        category: "Backend",
        difficulty: "Hard",
      }).success,
    ).toBe(false);
    expect(DifficultySchema.safeParse("Impossible").success).toBe(false);
  });

  test("generates interview questions and model answers from project context", async () => {
    let promptSent = "";
    const result = await generateInterviewQuestion(
      {
        category: "Database",
        difficulty: "Hard",
        projectName: "InterviewForge",
        technologies: ["PostgreSQL"],
        chunks: projectChunks,
      },
      async (prompt) => {
        promptSent = prompt;
        return JSON.stringify({
          question: "How does pgvector support project retrieval?",
          expectedAnswer:
            "It stores text vectors in PostgreSQL and supports nearest-neighbor similarity search for retrieving related project chunks.",
        });
      },
    );
    expect(promptSent).toContain("1536-dimensional text embeddings");
    expect(promptSent).toContain("Project-Specific Example");
    expect(result.expectedAnswer).toContain("nearest-neighbor");
  });

  test("evaluates practice answers with a validated response", async () => {
    const evaluation = await evaluatePracticeAnswer(
      {
        question: "Why does the project use pgvector?",
        expectedAnswer: "It supports semantic retrieval of stored embeddings.",
        userAnswer:
          "It lets PostgreSQL search for similar document embeddings.",
        chunks: projectChunks,
      },
      async () =>
        JSON.stringify({
          score: 8,
          whatYouGotRight: ["Identified similarity search"],
          whatWasMissing: ["Mention the stored vector dimensions"],
          howToImprove: ["Explain how the retrieved chunks ground generation"],
          idealAnswer:
            "The app stores 1536-dimensional embeddings in pgvector and retrieves semantically similar document chunks to ground answers.",
        }),
    );
    expect(evaluation.score).toBe(8);
    expect(evaluation.whatYouGotRight).toHaveLength(1);
    expect(isQuizAnswerCorrect("a", " A ")).toBe(true);
    expect(isQuizAnswerCorrect("B", "A")).toBe(false);
  });

  test("requires project knowledge and rejects invalid practice transitions", () => {
    expect(() => assertProjectHasKnowledge(false, false)).toThrow(
      "Project not found",
    );
    expect(() => assertProjectHasKnowledge(true, false)).toThrow(
      "process at least one",
    );
    expect(() => assertProjectHasKnowledge(true, true)).not.toThrow();
    expect(() => assertPracticeCanContinue("ACTIVE", false)).toThrow(
      "Submit an answer",
    );
    expect(() => assertPracticeCanContinue("COMPLETED", true)).toThrow(
      "complete",
    );
    expect(() => assertPracticeCanContinue("ACTIVE", true)).not.toThrow();
  });
});
