export const AI_API_BASE_URL = "https://aicredits.in/v1";
export const VOICE_API_BASE_URL = "https://api.aicredits.in/v1";
export const EVALUATION_MODEL = "gpt-4o-mini";
export const VOICE_CHAT_MODEL = "openai/gpt-4o-mini";
export const TRANSCRIPTION_MODEL = "openai/whisper-1";
export const SPEECH_MODEL = "openai/tts-1";
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
export const EMBEDDING_BATCH_SIZE = 100;
export const MAX_DOCUMENT_SIZE_MB = Number.parseInt(
  process.env.MAX_DOCUMENT_SIZE_MB ?? "20",
  10,
);
export const DOCUMENT_CHUNK_SIZE = 1000;
export const DOCUMENT_CHUNK_OVERLAP = 200;
