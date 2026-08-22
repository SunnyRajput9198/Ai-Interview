import type { RetrievedChunk } from "./knowledge-retrieval";

export function buildInterviewSystemPrompt(opts: {
  interviewType: string;
  project: { name: string; description: string | null; technologies: string[] } | null;
  topics: string[];
  retrievedChunks: RetrievedChunk[];
  conversations: { type: string; message: string }[];
}): string {
  const { interviewType, project, topics, retrievedChunks, conversations } = opts;

  const projectSection = project
    ? `\n## Project Context\n- Project: ${project.name}\n- Description: ${
        project.description ?? "No description provided"
      }\n- Technologies: ${
        project.technologies.length ? project.technologies.join(", ") : "Not specified"
      }`
    : topics.length > 0
    ? `\n## Topics Focus\n${topics.map((t) => `- ${t}`).join("\n")}`
    : "";

  const docsSection =
    retrievedChunks.length > 0
      ? `\n## Retrieved Documentation\nThe following is relevant documentation from the candidate's uploaded materials.\nBase your questions on it and detect inconsistencies between what the docs say and what the candidate claims.\n\n${retrievedChunks
          .map((c) => `### [${c.documentName}]\n${c.content}`)
          .join("\n\n---\n\n")}`
      : "";

  const priorConversation =
    conversations.length > 0
      ? `\n## Prior Conversation\n${conversations
          .map((c) => `${c.type}: ${c.message}`)
          .join("\n")}`
      : "";

  const projectInstructions =
    interviewType === "PROJECT"
      ? `\nFor this PROJECT interview, test the candidate's genuine understanding across:\n- Architecture choices and rationale (why this design?)\n- Technology decisions (why each technology was chosen?)\n- Backend and API design patterns\n- Database schema and relationships\n- Scaling strategy and bottlenecks\n- Reliability and error handling\n- Security approach\n- Trade-offs and alternatives considered`
      : "";

  return `You are an expert technical interviewer conducting a ${interviewType} interview.
${projectSection}
${docsSection}

## Interview Instructions
- This is a TURN-BASED voice interview. Ask ONE question at a time and wait for the candidate's answer before asking the next.
- Ask 5–8 focused questions total, adapting based on answers.
- Use English only.
- Base your questions STRICTLY on the documentation provided above (if any).
- Do NOT invent project details not present in the documentation.
- If the candidate's answer contradicts the documentation, call it out: "Your docs say X, but you mentioned Y — can you explain that?"
- If no docs cover a topic, ask the candidate directly rather than fabricating context.
- Start with a warm opening question inviting the candidate to describe their background or project.
${projectInstructions}
${priorConversation}`.trim();
}
