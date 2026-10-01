import { z } from "zod";
import { getAIClient } from "./ai-client";
import { EVALUATION_MODEL } from "./config";
import type { RetrievedChunk } from "./knowledge-retrieval";

// ── Schemas ───────────────────────────────────────────────────────────────────

const projectSubScoresSchema = z.object({
  architectureUnderstanding: z.number().min(0).max(10),
  technologyDecisions: z.number().min(0).max(10),
  implementationKnowledge: z.number().min(0).max(10),
  databaseKnowledge: z.number().min(0).max(10),
  scalingKnowledge: z.number().min(0).max(10),
  securityKnowledge: z.number().min(0).max(10),
  tradeoffUnderstanding: z.number().min(0).max(10),
});

const outputSchema = z.object({
  feedback: z.string().describe("Detailed feedback for the candidate"),
  score: z.number().min(0).max(10).describe("Overall score out of 10"),
  subScores: projectSubScoresSchema
    .optional()
    .describe("Project understanding sub-scores (only for PROJECT interviews)"),
  citations: z
    .array(z.string())
    .optional()
    .describe(
      "Document names whose content was relevant to evaluating answers",
    ),
  weaknesses: z
    .array(z.string())
    .optional()
    .describe("Specific weakness patterns detected in the candidate's answers"),
});

export type EvaluationResult = z.infer<typeof outputSchema>;

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildEvaluationPrompt(
  messages: { type: string; message: string; createdAt: Date }[],
  interviewType: string,
  usedChunks: RetrievedChunk[] | null,
): string {
  const isProject = interviewType === "PROJECT";

  const docsContext =
    usedChunks && usedChunks.length > 0
      ? `\n## Documentation Used During Interview\nThe following excerpts were provided to the interviewer as ground truth. Assess whether the candidate's answers are accurate and consistent with this documentation.\n\n${usedChunks
          .map((c) => `### [${c.documentName}]\n${c.content}`)
          .join("\n\n---\n\n")}\n`
      : "";

  const projectSubScoreInstructions = isProject
    ? `\n## Project Understanding Sub-Scores (required for PROJECT interviews)\nScore each dimension 0–10:\n- architectureUnderstanding: understands why the architecture was chosen\n- technologyDecisions: can explain WHY each technology was selected\n- implementationKnowledge: understands how the system was built\n- databaseKnowledge: understands schema and data relationships\n- scalingKnowledge: can explain scaling strategy and bottlenecks\n- securityKnowledge: understands security concerns and mitigations\n- tradeoffUnderstanding: can articulate trade-offs and alternatives\n`
    : "";

  return `You are an expert interview evaluator. Evaluate the following ${interviewType} interview transcript and return a JSON object ONLY — no markdown, no extra text.
${docsContext}
## Interview Transcript
${JSON.stringify(messages, null, 2)}

## Instructions
1. Overall score 0–10.
2. Detailed, constructive feedback.
3. Detect weakness patterns:
   - Knows WHAT technology was used but not WHY
   - Understands architecture but not data flow
   - Knows implementation but not how to scale it
   - Describes project but cannot defend architectural decisions
4. Citations: document names from the Documentation section whose content was relevant. Empty array if none.
${projectSubScoreInstructions}
Required JSON shape:
{
  "feedback": "string",
  "score": 0-10,
  "subScores": { "architectureUnderstanding": 0-10, "technologyDecisions": 0-10, "implementationKnowledge": 0-10, "databaseKnowledge": 0-10, "scalingKnowledge": 0-10, "securityKnowledge": 0-10, "tradeoffUnderstanding": 0-10 },
  "citations": ["doc.pdf"],
  "weaknesses": ["weakness description"]
}
Omit "subScores" if this is not a PROJECT interview.`;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function calculateResult(
  messages: { type: "Assistant" | "User"; message: string; createdAt: Date }[],
  interviewType = "TECHNICAL",
  usedChunks: RetrievedChunk[] | null = null,
): Promise<EvaluationResult> {
  const prompt = buildEvaluationPrompt(messages, interviewType, usedChunks);

  const response = await getAIClient().chat.completions.create({
    model: EVALUATION_MODEL,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  const text = response.choices[0]?.message?.content ?? "{}";
  const parsed = outputSchema.parse(JSON.parse(text));
  return parsed;
}
