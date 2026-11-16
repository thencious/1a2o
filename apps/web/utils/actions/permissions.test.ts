import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestLogger } from "@/__tests__/helpers";
const { tokens, permissions } = vi.hoisted(() => ({
  tokens: vi.fn(),
  permissions: vi.fn(),
}));
vi.mock("@/utils/actions/safe-action", () => {
  const builder = {
    metadata: () => builder,
    inputSchema: () => builder,
    action: (handler: unknown) => handler,
  };
  return { actionClient: builder, adminActionClient: builder };
});
vi.mock("@/utils/email-account-client", () => ({
  getGmailAndAccessTokenForEmail: tokens,
  getOutlookClientForEmail: vi.fn(),
}));
vi.mock("@/utils/gmail/permissions", () => ({
  handleGmailPermissionsCheck: permissions,
}));
vi.mock("@/utils/prisma", () => ({ default: {} }));
import { checkPermissionsAction } from "./permissions";
const input = {
  ctx: {
    emailAccountId: "account-one",
    provider: "google",
    logger: createTestLogger(),
  },
};
describe("confirmed missing mailbox permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tokens.mockResolvedValue({
      accessToken: "access",
      tokens: { refreshToken: "refresh", scope: "test" },
    });
  });
  it("distinguishes a successful scope inspection from unavailable token or provider checks", async () => {
    permissions.mockResolvedValue({
      hasAllPermissions: false,
      missingScopes: ["gmail.modify"],
    });
    expect(await checkPermissionsAction(input as never)).toMatchObject({
      hasRefreshToken: true,
      hasAllPermissions: false,
      missingPermissions: true,
    });
    tokens.mockRejectedValueOnce(new Error("Provider temporarily unavailable"));
    expect(await checkPermissionsAction(input as never)).toEqual({
      hasRefreshToken: false,
      hasAllPermissions: false,
    });
    tokens.mockResolvedValueOnce({
      accessToken: null,
      tokens: { refreshToken: "refresh" },
    });
    expect(await checkPermissionsAction(input as never)).toEqual({
      hasRefreshToken: true,
      hasAllPermissions: false,
    });
  });
  it("does not label rejected authentication as a confirmed missing scope", async () => {
    permissions.mockResolvedValue({
      hasAllPermissions: false,
      error: "Token expired",
      missingScopes: ["gmail.modify"],
    });
    expect(await checkPermissionsAction(input as never)).toEqual({
      hasRefreshToken: false,
      hasAllPermissions: false,
    });
  });
});
