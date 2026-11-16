import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { getCalendarOAuth2Client } from "@/utils/calendar/client";
import { generateSignedOAuthState } from "@/utils/oauth/state";

vi.mock("@/utils/middleware", () => ({
  withEmailAccount: (...args: unknown[]) => args.at(-1),
}));
vi.mock("@/utils/calendar/client", () => ({
  getCalendarOAuth2Client: vi.fn(),
}));
vi.mock("@/utils/oauth/state", () => ({
  generateSignedOAuthState: vi.fn(() => "signed-state"),
  oauthStateCookieOptions: { httpOnly: true },
}));
beforeEach(() => {
  vi.clearAllMocks();
});

it("requests writing consent for the intended Google account with a signed editing requirement", async () => {
  const generateAuthUrl = vi.fn(
    () => "https://accounts.google.com/test-consent",
  );
  vi.mocked(getCalendarOAuth2Client).mockReturnValue({
    generateAuthUrl,
  } as never);
  const request = new NextRequest(
    "http://localhost/api/google/calendar/auth-url?editing=true&loginHint=calendar%40example.com",
  );
  Object.assign(request, { auth: { emailAccountId: "owned-mailbox" } });
  const response = await GET(request as never, {} as never);
  expect(response.status).toBe(200);
  expect(generateSignedOAuthState).toHaveBeenCalledWith({
    emailAccountId: "owned-mailbox",
    type: "calendar",
    requireWrite: true,
  });
  expect(generateAuthUrl).toHaveBeenCalledWith(
    expect.objectContaining({
      prompt: "consent",
      login_hint: "calendar@example.com",
      include_granted_scopes: true,
      scope: expect.arrayContaining([
        "https://www.googleapis.com/auth/calendar.events",
      ]),
    }),
  );
});
