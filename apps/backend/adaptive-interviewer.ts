import { z } from "zod";
import { getAIClient } from "./ai-client";
import { EVALUATION_MODEL } from "./config";
import type { RetrievedChunk } from "./knowledge-retrieval";

const systemDesignStages = [
  "requirements",
  "clarification",
  "architecture",
  "components",
  "data",
  "scaling",
  "reliability",
  "tradeoffs",
] as const;

export const AdaptiveStateSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return value;
    const state = value as Record<string, unknown>;
    if (state.remainingQuestions !== undefined) return state;
    const limit =
      typeof state.questionLimit === "number" ? state.questionLimit : 8;
    const answered =
      typeof state.questionsAnswered === "number" ? state.questionsAnswered : 0;
    return { ...state, remainingQuestions: Math.max(0, limit - answered) };
  },
  z.object({
    questionLimit: z.number().int().min(5).max(10).default(8),
    questionsAsked: z.number().int().min(0).default(0),
    questionsAnswered: z.number().int().min(0).default(0),
    currentTopic: z.string().nullable().default(null),
    currentDifficulty: z
      .enum(["foundational", "intermediate", "advanced"])
      .default("intermediate"),
    systemDesignStage: z.enum(systemDesignStages).nullable().default(null),
    topicScores: z
      .array(
        z.object({
          topic: z.string(),
          scores: z.array(z.number().min(0).max(10)),
        }),
      )
      .default([]),
    averageScore: z.number().min(0).max(10).nullable().default(null),
    weakTopics: z.array(z.string()).default([]),
    strongTopics: z.array(z.string()).default([]),
    recentAnswerQuality: z
      .number()
      .int()
      .min(0)
      .max(10)
      .nullable()
      .default(null),
    remainingQuestions: z.number().int().min(0).default(8),
    interviewGoal: z.string().default("adaptive technical interview"),
    recentGaps: z.array(z.string()).default([]),
    completed: z.boolean().default(false),
  }),
);

export type AdaptiveState = z.infer<typeof AdaptiveStateSchema>;

export type AdaptivePromptMessage = {
  role: "system" | "user";
  content: string;
};
export type AdaptiveCompletion = (
  messages: AdaptivePromptMessage[],
  options: { temperature: number; maxTokens: number },
) => Promise<string>;

async function completeWithProvider(
  messages: AdaptivePromptMessage[],
  options: { temperature: number; maxTokens: number },
): Promise<string> {
  const completion = await getAIClient().chat.completions.create({
    model: EVALUATION_MODEL,
    temperature: options.temperature,
    max_tokens: options.maxTokens,
    response_format: { type: "json_object" },
    messages,
  });
  return completion.choices[0]?.message?.content ?? "";
}

const TurnSchema = z.object({
  score: z.number().int().min(0).max(10),
  topic: z.string().min(1).max(80),
  strengths: z.array(z.string()).max(3),
  gaps: z.array(z.string()).max(4),
  nextQuestion: z.string().min(5).max(600),
  nextTopic: z.string().min(1).max(80),
});

const OpeningSchema = z.object({
  question: z.string().min(5).max(600),
  topic: z.string().min(1).max(80),
  difficulty: z.enum(["foundational", "intermediate", "advanced"]),
});

function parseJson<T>(content: string, schema: z.ZodType<T>): T {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return schema.parse(JSON.parse(cleaned));
}

function promptContext(opts: {
  interviewType: string;
  topics: string[];
  project: {
    name: string;
    description: string | null;
    technologies: string[];
  } | null;
  chunks: RetrievedChunk[];
  priorWeaknesses: string[];
  recentHistory: { type: string; message: string }[];
  state: AdaptiveState;
}): string {
  const design = opts.interviewType === "SYSTEM_DESIGN";
  return [
    `Interview mode: ${opts.interviewType}.`,
    `Candidate topics: ${opts.topics.join(", ") || "choose from the project and interview mode"}.`,
    opts.project
      ? `Project: ${opts.project.name}. ${opts.project.description ?? ""} Technologies: ${opts.project.technologies.join(", ") || "not specified"}.`
      : "",
    `Recent prior interview weaknesses: ${opts.priorWeaknesses.join("; ") || "none available"}. If relevant, use a prior weak area for roughly one in three questions, while preserving mode coverage and following the candidate's answers.`,
    `State: ${JSON.stringify(opts.state)}.`,
    `Remaining interviewer questions: ${opts.state.remainingQuestions}. Interview goal: ${opts.state.interviewGoal}. Use the remaining budget to cover important gaps without rushing or repeating topics.`,
    `Recent conversation (oldest first):\n${opts.recentHistory.map((m) => `${m.type}: ${m.message}`).join("\n") || "No previous turns."}`,
    opts.chunks.length
      ? `Retrieved project/knowledge context (use only supported facts for claims about the candidate's project):\n${opts.chunks.map((c) => `[${c.documentName}] ${c.content}`).join("\n---\n")}`
      : "No retrieved knowledge snippets are available.",
    design
      ? `System design stage progression: requirements → clarification → architecture → components → data → scaling → reliability → tradeoffs. Current stage: ${opts.state.systemDesignStage ?? "requirements"}. Keep one evolving design problem and ask about only the next stage. If the answer is weak (<5), ask one clarifying follow-up in the same stage; otherwise advance one stage.`
      : "",
    opts.interviewType === "PROJECT"
      ? "Project mode: probe architecture, implementation, data and trade-offs only when grounded in the project/document context. Do not introduce technologies absent from that context as project facts."
      : "",
    opts.interviewType === "AI_ML"
      ? "AI/ML mode: cover model fundamentals, data preparation, evaluation, deployment and responsible operation, adapting to provided topics and project evidence."
      : "",
    opts.interviewType === "MIXED"
      ? "Mixed mode: balance technical fundamentals, architecture, project reasoning and practical trade-offs across the interview."
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function openingQuestion(
  opts: Parameters<typeof promptContext>[0],
  complete: AdaptiveCompletion = completeWithProvider,
) {
  const content = await complete(
    [
      {
        role: "system",
        content: `You are an expert adaptive interviewer. Ask one concise spoken question only, and return JSON with question, topic, and difficulty. This is the opening question. Start with a short warm introduction then ask a specific question. For SYSTEM_DESIGN, introduce one realistic design prompt and begin requirements. Use exactly one question. Never invent facts about the candidate's own project; hypothetical design scenarios are allowed.`,
      },
      { role: "user", content: promptContext(opts) },
    ],
    { temperature: 0.5, maxTokens: 220 },
  );
  return parseJson(content, OpeningSchema);
}

export async function evaluateAndChooseNext(
  opts: Parameters<typeof promptContext>[0] & {
    lastQuestion: string;
    answer: string;
  },
  complete: AdaptiveCompletion = completeWithProvider,
) {
  const content = await complete(
    [
      {
        role: "system",
        content: `Evaluate the candidate's latest answer from 0 to 10 for correctness, specificity, reasoning and relevance. Then adaptively decide one next question. Return JSON only with: score (integer 0-10), topic, strengths (up to 3 short items), gaps (up to 4 short items), nextQuestion, nextTopic. Ask exactly one question. The next question must directly build on the answer: below 5 ask a supportive foundational follow-up on the same topic; 5-7 probe a gap or application; 8-10 increase depth/difficulty or move to an adjacent topic. Use candidate-selected topics and prior weaknesses when relevant, but avoid repeating completed areas. If one question remains, prioritize a concise closing question on the most important uncovered area. Do not reveal numeric score or private evaluation in the spoken nextQuestion. Ground claims about the candidate's project only in supplied context. Do not fabricate document facts. Keep the next question concise and natural for speech.`,
      },
      {
        role: "user",
        content: `${promptContext(opts)}\n\nQuestion just asked: ${opts.lastQuestion}\nCandidate answer to evaluate: ${opts.answer}`,
      },
    ],
    { temperature: 0.35, maxTokens: 420 },
  );
  return parseJson(content, TurnSchema);
}

function meaningfulTokens(question: string): Set<string> {
  const stopWords = new Set([
    "what",
    "when",
    "where",
    "which",
    "would",
    "could",
    "should",
    "your",
    "about",
    "with",
    "from",
    "that",
    "this",
    "does",
    "into",
    "have",
    "help",
    "explain",
    "describe",
    "tell",
    "give",
    "more",
    "than",
    "then",
    "they",
    "them",
    "their",
    "there",
    "how",
    "can",
    "you",
    "the",
    "and",
    "for",
    "are",
    "was",
    "were",
    "why",
  ]);
  return new Set(
    question
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.map((word) => {
        if (word.length > 4 && word.endsWith("ies"))
          return `${word.slice(0, -3)}y`;
        if (word.length > 4 && word.endsWith("s")) return word.slice(0, -1);
        return word;
      })
      .filter((word) => word.length > 2 && !stopWords.has(word)) ?? [],
  );
}

export function repeatsQuestion(
  candidate: string,
  previousQuestions: string[],
): boolean {
  const candidateTokens = meaningfulTokens(candidate);
  if (!candidateTokens.size) return false;
  return previousQuestions.some((previous) => {
    const previousTokens = meaningfulTokens(previous);
    if (!previousTokens.size) return false;
    const overlap = [...candidateTokens].filter((token) =>
      previousTokens.has(token),
    ).length;
    const containment =
      overlap / Math.min(candidateTokens.size, previousTokens.size);
    const jaccard =
      overlap / new Set([...candidateTokens, ...previousTokens]).size;
    return containment >= 0.8 && jaccard >= 0.55;
  });
}

export function replaceRepeatedQuestion(opts: {
  candidate: string;
  previousQuestions: string[];
  topic: string;
  gaps: string[];
}): string {
  if (!repeatsQuestion(opts.candidate, opts.previousQuestions))
    return opts.candidate;
  const gap = opts.gaps[0]?.trim().replace(/[.!?]+$/, "");
  if (gap)
    return `Could you explain ${gap} in more detail, with a concrete example?`;
  return `Can you give a concrete example of ${opts.topic} and explain one trade-off?`;
}

export function isDuplicateSubmission(
  requestMessages: { role: "user" | "assistant"; content: string }[],
  storedMessages: { type: "User" | "Assistant"; message: string }[],
): boolean {
  const lastUserIndex = requestMessages.findLastIndex(
    (message) => message.role === "user",
  );
  if (lastUserIndex < 0)
    return requestMessages.length === 0 && storedMessages.length > 0;
  if (storedMessages.length < 2) return false;
  const [storedUser, storedAssistant] = storedMessages.slice(-2);
  if (storedUser?.type !== "User" || storedAssistant?.type !== "Assistant")
    return false;
  if (storedUser.message !== requestMessages[lastUserIndex]?.content)
    return false;
  const expectedHistory = requestMessages.slice(0, lastUserIndex);
  const priorTranscript = storedMessages.slice(0, -2);
  return (
    expectedHistory.length === priorTranscript.length &&
    expectedHistory.every(
      (message, index) =>
        message.role ===
          (priorTranscript[index]?.type === "User" ? "user" : "assistant") &&
        message.content === priorTranscript[index]?.message,
    )
  );
}

export function updateAdaptiveState(
  state: AdaptiveState,
  turn: z.infer<typeof TurnSchema>,
  interviewType: string,
): AdaptiveState {
  const topicScores = [...state.topicScores];
  const topic = topicScores.find(
    (item) => item.topic.toLowerCase() === turn.topic.toLowerCase(),
  );
  if (topic) topic.scores = [...topic.scores, turn.score];
  else topicScores.push({ topic: turn.topic, scores: [turn.score] });

  const completed = state.questionsAnswered + 1 >= state.questionLimit;
  const allScores = topicScores.flatMap((item) => item.scores);
  const topicAverages = topicScores.map((item) => ({
    topic: item.topic,
    average:
      item.scores.reduce((sum, score) => sum + score, 0) / item.scores.length,
  }));
  const nextDifficulty =
    turn.score < 5
      ? "foundational"
      : turn.score < 8
        ? state.currentDifficulty
        : state.currentDifficulty === "foundational"
          ? "intermediate"
          : "advanced";
  const stageIndex = state.systemDesignStage
    ? systemDesignStages.indexOf(state.systemDesignStage)
    : 0;
  const nextStage =
    interviewType === "SYSTEM_DESIGN"
      ? turn.score < 5
        ? systemDesignStages[Math.max(0, stageIndex)]
        : systemDesignStages[
            Math.min(systemDesignStages.length - 1, stageIndex + 1)
          ]
      : null;
  return AdaptiveStateSchema.parse({
    ...state,
    questionsAnswered: state.questionsAnswered + 1,
    questionsAsked: state.questionsAsked + (completed ? 0 : 1),
    currentTopic: turn.nextTopic,
    currentDifficulty: nextDifficulty,
    systemDesignStage: nextStage,
    topicScores,
    averageScore: allScores.length
      ? allScores.reduce((sum, score) => sum + score, 0) / allScores.length
      : null,
    weakTopics: topicAverages
      .filter((item) => item.average < 5)
      .map((item) => item.topic),
    strongTopics: topicAverages
      .filter((item) => item.average >= 8)
      .map((item) => item.topic),
    recentAnswerQuality: turn.score,
    remainingQuestions: Math.max(
      0,
      state.questionLimit - (state.questionsAnswered + 1),
    ),
    recentGaps: [...state.recentGaps, ...turn.gaps].slice(-8),
    completed,
  });
}
