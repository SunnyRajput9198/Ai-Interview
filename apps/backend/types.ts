import { z } from "zod";

export const PreInterviewBody = z.object({
  interviewType: z.enum([
    "TECHNICAL",
    "PROJECT",
    "SYSTEM_DESIGN",
    "AI_ML",
    "MIXED",
    "HR",
    "FULL",
  ]),
  projectId: z.string().uuid().optional(),
  topics: z.array(z.string()).optional(),
  questionLimit: z.number().int().min(5).max(10).default(8),
});

export const KnowledgeSourceTypeSchema = z.enum([
  "RESUME",
  "PROJECT",
  "ARCHITECTURE",
  "TECHNICAL_NOTES",
  "API_DOCUMENTATION",
  "DATABASE_DOCUMENTATION",
  "DEPLOYMENT",
  "INTERVIEW_PREPARATION",
  "OTHER",
]);

export type KnowledgeSourceType = z.infer<typeof KnowledgeSourceTypeSchema>;

export type PreInterviewBodyType = z.infer<typeof PreInterviewBody>;
export type InterviewType = PreInterviewBodyType["interviewType"];
