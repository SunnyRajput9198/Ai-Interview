CREATE TYPE "LearningSessionKind" AS ENUM ('QUIZ', 'PRACTICE');
CREATE TYPE "LearningSessionStatus" AS ENUM ('ACTIVE', 'COMPLETED');

CREATE TABLE "LearningSession" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "LearningSessionKind" NOT NULL,
    "status" "LearningSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "state" JSONB NOT NULL,
    "answers" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LearningSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LearningSession_projectId_kind_status_idx"
    ON "LearningSession"("projectId", "kind", "status");

ALTER TABLE "LearningSession"
    ADD CONSTRAINT "LearningSession_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
