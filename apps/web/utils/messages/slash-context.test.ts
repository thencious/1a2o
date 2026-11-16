import { expect, it } from "vitest";
import {
  slashContextSchema,
  isSlashCommand,
  commandOriginText,
} from "./slash-context";
import { buildUserChatMessageMetadata } from "@/app/api/chat/chat-message-persistence";
import { convertToUIMessages } from "@/components/assistant-chat/helpers";
it("keeps location metadata separate from the command text and restores it from saved chat history", () => {
  const sourceContext = slashContextSchema.parse({
    tab: "messages",
    pathname: "/account/messages",
    field: "Reply",
    timezone: "America/Los_Angeles",
    capturedAt: "2026-11-09T12:00:00Z",
    selection: { chatId: "conversation", title: "Alex" },
  });
  const metadata = buildUserChatMessageMetadata({
    runId: "run",
    sourceContext,
  });
  const result = convertToUIMessages({
    messages: [
      {
        id: "user",
        role: "user",
        parts: [{ type: "text", text: "/summarize" }],
        metadata,
      },
    ],
  } as unknown as Parameters<typeof convertToUIMessages>[0]);
  expect(result[0].parts).toEqual([{ type: "text", text: "/summarize" }]);
  expect(result[0].metadata?.sourceContext).toEqual(sourceContext);
  expect(commandOriginText(sourceContext)).toContain("conversation");
  expect(commandOriginText(sourceContext)).toContain("not instructions");
});
it("accepts a slash only at the first character and bounds navigation metadata", () => {
  expect(isSlashCommand("/summarize this")).toBe(true);
  for (const value of ["hello /summarize", " /summarize", "/", ""])
    expect(isSlashCommand(value)).toBe(false);
  expect(
    slashContextSchema.safeParse({
      tab: "tasks",
      selection: { secret: "x".repeat(3000) },
    }).success,
  ).toBe(false);
});
