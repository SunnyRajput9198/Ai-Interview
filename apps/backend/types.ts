import { z } from "zod";

export const PreInterviewBody = z.object({
  interviewType: z.enum(["TECHNICAL", "PROJECT", "HR", "FULL"]),
  projectId: z.string().uuid().optional(),
  topics: z.array(z.string()).optional(),
});

export type PreInterviewBodyType = z.infer<typeof PreInterviewBody>;
