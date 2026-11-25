import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { sendMessage, writableBeeperChat } from "@/utils/beeper/service";
import { createScopedLogger } from "@/utils/logger";
import {
  processDueScheduledMessages,
  scheduleConversationMessage,
} from "./scheduled";

vi.mock("@/utils/prisma");
vi.mock("@/utils/beeper/connection", () => ({ assertBeeperOwner: vi.fn() }));
vi.mock("@/utils/beeper/service", () => ({
  writableBeeperChat: vi.fn(),
  sendMessage: vi.fn(),
}));

const id = "518379c1-ebaa-484f-922c-8157e58589d8";
const sendAt = new Date("2099-11-25T15:00:00Z");
const message = {
  id,
  userId: "owner",
  chatId: "conversation",
  text: "whatsup",
  sendAt,
  nextAttemptAt: sendAt,
  timezone: "America/Los_Angeles",
  status: "PENDING",
};
const logger = createScopedLogger("scheduled-message-test");

describe("scheduled conversation messages", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("keeps an explicit future command queued with its original chat and text", async () => {
    prisma.scheduledMessage.findFirst.mockResolvedValue(null);
    prisma.scheduledMessage.upsert.mockResolvedValue(message as never);
    const result = await scheduleConversationMessage({
      ...message,
      localTime: "2099-11-25T07:00",
    });
    expect(result.sendAt).toEqual(sendAt);
    expect(writableBeeperChat).toHaveBeenCalledWith("owner", "conversation");
    expect(prisma.scheduledMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          chatId: "conversation",
          text: "whatsup",
          sendAt,
          nextAttemptAt: sendAt,
        }),
      }),
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("sends to the original conversation only after the worker claims it", async () => {
    prisma.scheduledMessage.findMany.mockResolvedValue([message] as never);
    prisma.scheduledMessage.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(processDueScheduledMessages("owner", logger)).resolves.toEqual(
      { submitted: 0 },
    );
    expect(sendMessage).not.toHaveBeenCalled();

    prisma.scheduledMessage.updateMany.mockResolvedValue({ count: 1 });
    await expect(processDueScheduledMessages("owner", logger)).resolves.toEqual(
      { submitted: 1 },
    );
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith("owner", {
      chatId: "conversation",
      requestId: id,
      text: "whatsup",
    });
    expect(prisma.scheduledMessage.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: { status: "SUBMITTED", failure: null },
      }),
    );
  });
});
