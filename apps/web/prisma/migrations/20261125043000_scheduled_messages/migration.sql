CREATE TYPE "ScheduledMessageStatus" AS ENUM ('PENDING', 'SENDING', 'SUBMITTED', 'FAILED', 'CANCELED');

CREATE TABLE "ScheduledMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sendAt" TIMESTAMP(3) NOT NULL,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "ScheduledMessageStatus" NOT NULL DEFAULT 'PENDING',
    "failure" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScheduledMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScheduledMessage_status_nextAttemptAt_idx" ON "ScheduledMessage"("status", "nextAttemptAt");
CREATE INDEX "ScheduledMessage_userId_chatId_sendAt_idx" ON "ScheduledMessage"("userId", "chatId", "sendAt");
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
