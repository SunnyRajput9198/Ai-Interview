import { describe, expect, test } from "bun:test";
import {
  AdaptiveStateSchema,
  evaluateAndChooseNext,
  isDuplicateSubmission,
  replaceRepeatedQuestion,
  updateAdaptiveState,
  type AdaptiveState,
} from "./adaptive-interviewer";
import { createKeyedLock } from "./interview-concurrency";
import { getAIClient } from "./ai-client";

function state(questionLimit = 8, overrides: Partial<AdaptiveState> = {}) {
  return AdaptiveStateSchema.parse({
    questionLimit,
    questionsAsked: 1,
    remainingQuestions: questionLimit - 1,
    interviewGoal: "technical interview",
    ...overrides,
  });
}

function turn(score: number, topic = "Backend", nextTopic = topic) {
  return {
    score,
    topic,
    strengths: ["Relevant explanation"],
    gaps: score < 5 ? ["query performance trade-offs"] : [],
    nextQuestion: "How would you handle the next trade-off?",
    nextTopic,
  };
}

describe("adaptive interviewer", () => {
  test("AI client imports safely without credentials and reports a clear error only when called", () => {
    const configuredKey = process.env.OPENAI_KEY;
    delete process.env.OPENAI_KEY;
    try {
      expect(() => getAIClient()).toThrow("OPENAI_KEY is required");
    } finally {
      if (configuredKey !== undefined) process.env.OPENAI_KEY = configuredKey;
    }
  });

  test("validates model output and uses the candidate answer to choose a follow-up", async () => {
    const capturedPrompts: string[] = [];
    const answers = ["Redis", "I would use a TTL and invalidate on writes"];
    const questions = [
      "How would you prevent stale Redis cache values?",
      "How would invalidation work across multiple app instances?",
    ];
    const complete = async (
      messages: { role: "system" | "user"; content: string }[],
    ) => {
      const prompt = messages[1]?.content ?? "";
      capturedPrompts.push(prompt);
      const index = capturedPrompts.length - 1;
      expect(prompt).toContain(
        `Candidate answer to evaluate: ${answers[index]}`,
      );
      return JSON.stringify({
        ...turn(index ? 8 : 4),
        nextQuestion: questions[index],
        nextTopic: "Caching",
      });
    };
    const context = {
      interviewType: "TECHNICAL",
      project: null,
      topics: ["Caching"],
      chunks: [],
      priorWeaknesses: [],
      recentHistory: [],
      state: state(),
      lastQuestion: "How would you implement caching?",
    };
    const first = await evaluateAndChooseNext(
      { ...context, answer: answers[0]! },
      complete,
    );
    const second = await evaluateAndChooseNext(
      { ...context, answer: answers[1]! },
      complete,
    );
    expect(first.nextQuestion).toBe(questions[0]!);
    expect(second.nextQuestion).toBe(questions[1]!);
    expect(capturedPrompts[0]).not.toBe(capturedPrompts[1]);
  });

  test("adapts difficulty deterministically for weak, average, and strong answers", () => {
    const initial = state(8, { currentDifficulty: "intermediate" });
    expect(
      updateAdaptiveState(initial, turn(4), "TECHNICAL").currentDifficulty,
    ).toBe("foundational");
    expect(
      updateAdaptiveState(initial, turn(6), "TECHNICAL").currentDifficulty,
    ).toBe("intermediate");
    expect(
      updateAdaptiveState(initial, turn(9), "TECHNICAL").currentDifficulty,
    ).toBe("advanced");
    expect(
      updateAdaptiveState(
        state(8, { currentDifficulty: "foundational" }),
        turn(8),
        "TECHNICAL",
      ).currentDifficulty,
    ).toBe("intermediate");
  });

  test("stops at exactly each supported question limit", () => {
    for (const limit of [5, 8, 10]) {
      let current = state(limit);
      while (!current.completed)
        current = updateAdaptiveState(current, turn(6), "TECHNICAL");
      expect(current.questionsAnswered).toBe(limit);
      expect(current.questionsAsked).toBe(limit);
      expect(current.remainingQuestions).toBe(0);
    }
  });

  test("derives remaining questions for persisted states written by the earlier Phase 5 schema", () => {
    const legacy = AdaptiveStateSchema.parse({
      questionLimit: 5,
      questionsAsked: 3,
      questionsAnswered: 2,
    });
    expect(legacy.remainingQuestions).toBe(3);
  });

  test("keeps weak System Design answers on-stage and advances on adequate answers", () => {
    const requirements = state(8, { systemDesignStage: "requirements" });
    expect(
      updateAdaptiveState(requirements, turn(3), "SYSTEM_DESIGN")
        .systemDesignStage,
    ).toBe("requirements");
    expect(
      updateAdaptiveState(requirements, turn(7), "SYSTEM_DESIGN")
        .systemDesignStage,
    ).toBe("clarification");
    const scaling = state(8, { systemDesignStage: "scaling" });
    expect(
      updateAdaptiveState(scaling, turn(8), "SYSTEM_DESIGN").systemDesignStage,
    ).toBe("reliability");
  });

  test("uses mode, RAG context, prior answers, and prior weak categories in its prompt", async () => {
    let prompt = "";
    await evaluateAndChooseNext(
      {
        interviewType: "AI_ML",
        project: {
          name: "Real App",
          description: "Search service",
          technologies: ["PostgreSQL", "pgvector"],
        },
        topics: [],
        chunks: [
          {
            documentId: "d1",
            documentName: "design.md",
            chunkIndex: 0,
            content: "Embeddings are 1536 dimensions.",
          },
        ],
        priorWeaknesses: ["System Design practice (4.0/10)"],
        recentHistory: [
          { type: "Assistant", message: "How are embeddings stored?" },
        ],
        state: state(),
        lastQuestion: "How are embeddings stored?",
        answer: "They are stored in Postgres.",
      },
      async (messages) => {
        prompt = messages[1]?.content ?? "";
        return JSON.stringify({
          ...turn(6, "AI/ML", "Retrieval"),
          nextQuestion: "How would embedding drift affect retrieval quality?",
        });
      },
    );
    expect(prompt).toContain("AI_ML");
    expect(prompt).toContain("1536 dimensions");
    expect(prompt).toContain("System Design practice");
    expect(prompt).toContain("How are embeddings stored?");
  });

  test("keeps Mixed mode coverage coherent with previously covered topics", async () => {
    let prompt = "";
    await evaluateAndChooseNext(
      {
        interviewType: "MIXED",
        project: null,
        topics: ["Backend", "AI/ML", "System Design"],
        chunks: [],
        priorWeaknesses: [],
        recentHistory: [
          { type: "Assistant", message: "How does the API handle retries?" },
          { type: "User", message: "It uses bounded exponential backoff." },
        ],
        state: state(8, {
          currentTopic: "Backend",
          topicScores: [{ topic: "Backend", scores: [8] }],
        }),
        lastQuestion: "How does the API handle retries?",
        answer: "It uses bounded exponential backoff.",
      },
      async (messages) => {
        prompt = messages[1]?.content ?? "";
        return JSON.stringify({
          ...turn(8, "Backend", "AI/ML"),
          nextQuestion:
            "How would you monitor drift in a model served by this API?",
        });
      },
    );
    expect(prompt).toContain("Mixed mode: balance technical fundamentals");
    expect(prompt).toContain("Backend, AI/ML, System Design");
    expect(prompt).toContain('"Backend"');
  });

  test("rejects malformed model output without any provider request", async () => {
    await expect(
      evaluateAndChooseNext(
        {
          interviewType: "MIXED",
          project: null,
          topics: [],
          chunks: [],
          priorWeaknesses: [],
          recentHistory: [],
          state: state(),
          lastQuestion: "A question?",
          answer: "An answer",
        },
        async () => "not JSON",
      ),
    ).rejects.toThrow();
  });

  test("detects exact and semantic repeats and creates a local alternate follow-up", () => {
    const prior = ["How does a database index improve query performance?"];
    expect(
      isDuplicateSubmission(
        [],
        [{ type: "Assistant", message: "Opening question" }],
      ),
    ).toBe(true);
    expect(
      replaceRepeatedQuestion({
        candidate: "How do indexes improve query performance in a database?",
        previousQuestions: prior,
        topic: "Database indexing",
        gaps: ["the write overhead of maintaining indexes"],
      }),
    ).toBe(
      "Could you explain the write overhead of maintaining indexes in more detail, with a concrete example?",
    );
    expect(
      replaceRepeatedQuestion({
        candidate: "What is a dead-letter queue?",
        previousQuestions: prior,
        topic: "Message queues",
        gaps: [],
      }),
    ).toBe("What is a dead-letter queue?");
  });

  test("recognizes a replay of a persisted answer without confusing a new turn", () => {
    const request = [
      {
        role: "assistant" as const,
        content: "How would you implement caching?",
      },
      { role: "user" as const, content: "Redis with a TTL." },
    ];
    const stored = [
      {
        type: "Assistant" as const,
        message: "How would you implement caching?",
      },
      { type: "User" as const, message: "Redis with a TTL." },
      {
        type: "Assistant" as const,
        message: "How would you invalidate stale values?",
      },
    ];
    expect(isDuplicateSubmission(request, stored)).toBe(true);
    expect(
      isDuplicateSubmission(
        [
          ...request,
          {
            role: "assistant",
            content: "How would you invalidate stale values?",
          },
          { role: "user", content: "On writes." },
        ],
        stored,
      ),
    ).toBe(false);
  });

  test("serializes concurrent response work per interview while allowing separate interviews", async () => {
    const locks = createKeyedLock();
    let active = 0;
    let maximumActive = 0;
    const submit = async (id: string) => {
      const release = await locks.acquire(id);
      try {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
      } finally {
        release();
      }
    };
    await Promise.all([submit("same"), submit("same"), submit("other")]);
    expect(maximumActive).toBe(2);
  });
});
