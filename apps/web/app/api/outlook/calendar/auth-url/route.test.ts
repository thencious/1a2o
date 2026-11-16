import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { getCalendarOAuth2Url } from "@/utils/outlook/calendar-client";
import { generateSignedOAuthState } from "@/utils/oauth/state";

vi.mock("@/utils/middleware", () => ({
  withEmailAccount: (...args: unknown[]) => args.at(-1),
}));
vi.mock("@/utils/outlook/calendar-client", () => ({
  getCalendarOAuth2Url: vi.fn(
    () => "https://login.microsoftonline.com/test-consent",
  ),
}));
vi.mock("@/utils/oauth/state", () => ({
  generateSignedOAuthState: vi.fn(() => "signed-state"),
  oauthStateCookieOptions: { httpOnly: true },
}));

it("requests an explicit Outlook editing consent screen for the intended account", async () => {
  const request = new NextRequest(
    "http://localhost/api/outlook/calendar/auth-url?editing=true&loginHint=calendar%40outlook.com",
  );
  Object.assign(request, { auth: { emailAccountId: "owned-mailbox" } });
  const response = await GET(request as never, {} as never);
  expect(response.status).toBe(200);
  expect(generateSignedOAuthState).toHaveBeenCalledWith({
    emailAccountId: "owned-mailbox",
    type: "calendar",
    requireWrite: true,
  });
  expect(getCalendarOAuth2Url).toHaveBeenCalledWith("signed-state", {
    editing: true,
    loginHint: "calendar@outlook.com",
  });
});
