-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create Project table
CREATE TABLE "Project" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "technologies" TEXT[] NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- Create KnowledgeSourceType enum
CREATE TYPE "KnowledgeSourceType" AS ENUM (
    'RESUME',
    'PROJECT',
    'ARCHITECTURE',
    'TECHNICAL_NOTES',
    'API_DOCUMENTATION',
    'DATABASE_DOCUMENTATION',
    'DEPLOYMENT',
    'INTERVIEW_PREPARATION',
    'OTHER'
);

-- Create ProcessingStatus enum
CREATE TYPE "ProcessingStatus" AS ENUM (
    'UPLOADED',
    'PROCESSING',
    'PROCESSED',
    'FAILED'
);

-- Create Document table
CREATE TABLE "Document" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "projectId" TEXT,
    "knowledgeSourceType" "KnowledgeSourceType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "processingStatus" "ProcessingStatus" NOT NULL DEFAULT 'UPLOADED',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- Create DocumentChunk table
CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "documentId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- Create InterviewType enum (if not exists, may already exist)
DO $$ BEGIN
    CREATE TYPE "InterviewType" AS ENUM ('TECHNICAL', 'PROJECT', 'HR', 'FULL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add new columns to Interview
ALTER TABLE "Interview"
    ADD COLUMN IF NOT EXISTS "projectId" TEXT,
    ADD COLUMN IF NOT EXISTS "topics" TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS "subScores" JSONB,
    ADD COLUMN IF NOT EXISTS "citations" TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS "usedChunks" JSONB,
    ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Add interviewType column if it doesn't exist
ALTER TABLE "Interview"
    ADD COLUMN IF NOT EXISTS "interviewType" "InterviewType" NOT NULL DEFAULT 'TECHNICAL';

-- Make score nullable if it isn't already
ALTER TABLE "Interview" ALTER COLUMN "score" DROP NOT NULL;

-- Drop githubMetadata column if it exists
ALTER TABLE "Interview" DROP COLUMN IF EXISTS "githubMetadata";

-- Add foreign key constraints
ALTER TABLE "Document"
    ADD CONSTRAINT "Document_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentChunk"
    ADD CONSTRAINT "DocumentChunk_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Interview"
    ADD CONSTRAINT "Interview_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Create index for vector similarity search
CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_idx" ON "DocumentChunk" USING ivfflat ("embedding" vector_cosine_ops);
