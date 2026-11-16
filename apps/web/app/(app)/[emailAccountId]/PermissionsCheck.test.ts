import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, checkPermissions, refreshAccounts, mutate, replace, effects } =
  vi.hoisted(() => ({
    state: {
      emailAccountId: "account-one",
      isAccountOwner: true,
      disconnectedAt: null as string | null,
    },
    checkPermissions: vi.fn(),
    refreshAccounts: vi.fn(),
    mutate: vi.fn(),
    replace: vi.fn(),
    effects: [] as (() => void)[],
  }));
vi.mock("react", () => ({
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => boolean) =>
    snapshot(),
  useEffect: (effect: () => (() => void) | undefined) => {
    const cleanup = effect();
    if (cleanup) effects.push(cleanup);
  },
}));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("@/components/ui/button", () => ({ Button: "button" }));
vi.mock("@/app/(app)/AppAlertBanner", () => ({ AppAlertBanner: "alert" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("swr", () => ({ useSWRConfig: () => ({ mutate }) }));
vi.mock("@/utils/actions/permissions", () => ({
  checkPermissionsAction: checkPermissions,
}));
vi.mock("@/providers/EmailAccountProvider", () => ({
  useAccount: () => ({
    emailAccountId: state.emailAccountId,
    emailAccount: { account: { disconnectedAt: state.disconnectedAt } },
  }),
}));
vi.mock("@/hooks/useAccounts", () => ({
  useAccounts: () => ({ mutate: refreshAccounts }),
}));
vi.mock("@/hooks/useOrgAccess", () => ({
  useOrgAccess: () => ({ isAccountOwner: state.isAccountOwner }),
}));

async function runCheck() {
  const { PermissionsCheck } = await import("./PermissionsCheck");
  return PermissionsCheck();
}
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("workspace permissions probe", () => {
  beforeEach(() => {
    for (const cleanup of effects.splice(0)) cleanup();
    vi.resetModules();
    vi.clearAllMocks();
    state.emailAccountId = "account-one";
    state.isAccountOwner = true;
    state.disconnectedAt = null;
    refreshAccounts.mockResolvedValue(undefined);
    mutate.mockResolvedValue(undefined);
  });

  it("keeps a failed permissions probe in the current workspace and refreshes shared warning data", async () => {
    checkPermissions.mockResolvedValue({
      data: { hasAllPermissions: false, hasRefreshToken: false },
    });
    await runCheck();
    await settle();
    expect(checkPermissions).toHaveBeenCalledWith("account-one");
    expect(refreshAccounts).toHaveBeenCalledOnce();
    expect(mutate).toHaveBeenCalledWith("/api/user/error-messages");
    expect(replace).not.toHaveBeenCalled();
  });

  it("skips remote permission checks for already disconnected accounts", async () => {
    state.disconnectedAt = "2026-11-01T12:00:00Z";
    await runCheck();
    expect(checkPermissions).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(refreshAccounts).not.toHaveBeenCalled();
  });

  it("does not mutate a newly selected workspace when an old account check finishes late", async () => {
    let finish: (result: unknown) => void = () => {};
    checkPermissions.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await runCheck();
    effects.splice(0).forEach((cleanup) => cleanup());
    state.emailAccountId = "account-two";
    finish({ data: { hasRefreshToken: false, hasAllPermissions: false } });
    await settle();
    expect(replace).not.toHaveBeenCalled();
    expect(refreshAccounts).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
    state.emailAccountId = "account-one";
    checkPermissions.mockResolvedValueOnce({
      data: { hasAllPermissions: true, hasRefreshToken: true },
    });
    await runCheck();
    await settle();
    expect(checkPermissions).toHaveBeenCalledTimes(2);
  });

  it("does not let a canceled request erase a newer in-flight check for the same account", async () => {
    let rejectOld: (reason: Error) => void = () => {};
    let finishNew: (result: unknown) => void = () => {};
    checkPermissions.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectOld = reject;
        }),
    );
    await runCheck();
    effects.splice(0).forEach((cleanup) => cleanup());
    checkPermissions.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishNew = resolve;
        }),
    );
    await runCheck();
    rejectOld(new Error("Old request failed"));
    await settle();
    await runCheck();
    expect(checkPermissions).toHaveBeenCalledTimes(2);
    finishNew({ data: { hasAllPermissions: true, hasRefreshToken: true } });
    await settle();
  });

  it("rechecks after reconnecting a previously disconnected mailbox", async () => {
    state.disconnectedAt = "2026-11-01T12:00:00Z";
    await runCheck();
    state.disconnectedAt = null;
    checkPermissions.mockResolvedValue({
      data: { hasAllPermissions: true, hasRefreshToken: true },
    });
    await runCheck();
    await settle();
    expect(checkPermissions).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
  });

  it("handles a rejected check without navigation and permits a later retry", async () => {
    checkPermissions.mockRejectedValueOnce(
      new Error("Provider temporarily unavailable"),
    );
    await runCheck();
    await settle();
    checkPermissions.mockResolvedValueOnce({
      data: { hasAllPermissions: true, hasRefreshToken: true },
    });
    await runCheck();
    await settle();
    expect(checkPermissions).toHaveBeenCalledTimes(2);
    expect(replace).not.toHaveBeenCalled();
    expect(refreshAccounts).not.toHaveBeenCalled();
  });

  it("shows an explicit reconnect action only for confirmed missing permissions", async () => {
    checkPermissions.mockResolvedValue({
      data: {
        hasAllPermissions: false,
        hasRefreshToken: true,
        missingPermissions: true,
      },
    });
    await runCheck();
    await settle();
    const warning = await runCheck();
    expect(warning?.props.title).toBe("Mailbox permissions required");
    expect(warning?.props.action.props.children.props.href).toBe(
      "/account-one/permissions/consent",
    );
    expect(replace).not.toHaveBeenCalled();
    state.disconnectedAt = "2026-11-01T12:00:00Z";
    expect(await runCheck()).toBeNull();
  });

  it("does not show a reconnect warning for ambiguous or transient check failures", async () => {
    checkPermissions.mockResolvedValue({
      data: { hasAllPermissions: false, hasRefreshToken: false },
    });
    await runCheck();
    await settle();
    expect(await runCheck()).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it("never probes accounts the signed-in user does not own", async () => {
    state.isAccountOwner = false;
    await runCheck();
    expect(checkPermissions).not.toHaveBeenCalled();
  });
});
