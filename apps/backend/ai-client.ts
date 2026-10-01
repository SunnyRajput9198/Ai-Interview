import OpenAI from "openai";
import {
  AI_API_BASE_URL,
  EMBEDDING_BATCH_SIZE,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
} from "./config";

let client: OpenAI | undefined;

export function getAIClient(): OpenAI {
  if (client) return client;
  const apiKey = process.env.OPENAI_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_KEY is required to make AI provider requests");
  }
  client = new OpenAI({ apiKey, baseURL: AI_API_BASE_URL });
  return client;
}

export async function createEmbeddings(inputs: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];

  for (let offset = 0; offset < inputs.length; offset += EMBEDDING_BATCH_SIZE) {
    const batch = inputs.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    const response = await getAIClient().embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
      dimensions: EMBEDDING_DIMENSIONS,
    });
    embeddings.push(
      ...response.data
        .sort((left, right) => left.index - right.index)
        .map(({ embedding }) => embedding),
    );
  }

  return embeddings;
}
