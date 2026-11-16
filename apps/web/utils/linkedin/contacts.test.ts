import { beforeEach, describe, expect, it, vi } from "vitest";
const { files, upstream, browserUpstream } = vi.hoisted(() => ({
  files: new Map<string, string>(),
  upstream: vi.fn(),
  browserUpstream: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("node:fs", () => ({ existsSync: () => true }));
vi.mock("node:fs/promises", () => ({
  mkdir: async () => {},
  readFile: async (path: string) => {
    if (!files.has(path))
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return files.get(path);
  },
  writeFile: async (path: string, value: string) => {
    files.set(path, value);
  },
  rename: async (from: string, to: string) => {
    files.set(to, files.get(from)!);
    files.delete(from);
  },
  unlink: async (path: string) => {
    files.delete(path);
  },
  readdir: async () =>
    [...files.keys()].map((path) => path.split(/[\\/]/).pop()),
}));
vi.mock("@/utils/encryption", () => ({
  encryptToken: (plain: string) =>
    `v1:${Buffer.from(plain).toString("base64")}`,
  decryptToken: (encoded: string) =>
    Buffer.from(encoded.slice(3), "base64").toString(),
}));
vi.mock("./snapshot", async (importOriginal) => {
  const original = await importOriginal<typeof import("./snapshot")>();
  return { ...original, readLinkedInConnections: upstream };
});
vi.mock("./voyager", async (importOriginal) => {
  const original = await importOriginal<typeof import("./voyager")>();
  return { ...original, readBrowserConnections: browserUpstream };
});
import { LinkedInSnapshotError } from "./snapshot";
import {
  connectLinkedInContacts,
  acceptLinkedInBrowserSession,
  disconnectLinkedInContacts,
  linkedInContactsStatus,
  syncDueLinkedInContacts,
  syncLinkedInContacts,
} from "./contacts";

beforeEach(() => {
  files.clear();
  upstream.mockReset();
  browserUpstream.mockReset();
  vi.useRealTimers();
  upstream.mockResolvedValue({
    contacts: [{ id: "one", name: "Example" }],
    pages: 1,
  });
});
describe("persistent LinkedIn auto sync", () => {
  it("keeps browser credentials private and resumes partial imports before replacing the directory", async () => {
    vi.useFakeTimers();
    const session = {
      userAgent: "Fixture browser user agent",
      csrf: "ajax:secret",
      cookies: [
        {
          name: "li_at",
          value: "secret-browser-cookie",
          domain: ".linkedin.com",
          path: "/",
          expires: -1,
        },
        {
          name: "JSESSIONID",
          value: "ajax:secret",
          domain: ".linkedin.com",
          path: "/",
          expires: -1,
        },
      ],
    };
    await acceptLinkedInBrowserSession("owner", session);
    const contacts = [{ id: "one", name: "Example" }];
    const progress = { contacts, start: 40, pages: 1, fingerprints: ["first"] };
    browserUpstream.mockResolvedValueOnce({
      complete: false,
      contacts,
      pages: 1,
      session,
      progress,
      error: {
        status: 429,
        message: "Pause requested",
        retryAfterMs: 3_600_000,
      },
    });
    const partial = await syncLinkedInContacts("owner");
    expect(partial.account?.contacts).toEqual(contacts);
    expect(partial.savedCount).toBe(1);
    expect(partial.pausedUntil).not.toBeNull();
    expect(partial.importedSoFar).toBe(1);
    expect(partial.requiresReconnect).toBe(false);
    expect(JSON.stringify(partial)).not.toContain("secret-browser-cookie");
    await acceptLinkedInBrowserSession("owner", session);
    const reconnected = await linkedInContactsStatus("owner");
    expect(reconnected.importedSoFar).toBe(1);
    expect(reconnected.error).toBe("Pause requested");
    expect(reconnected.pausedUntil).toBe(partial.pausedUntil);
    vi.setSystemTime(Date.now() + 120_000);
    await syncLinkedInContacts("owner", true);
    expect(browserUpstream).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 3_600_001);
    browserUpstream.mockResolvedValueOnce({
      complete: true,
      contacts,
      pages: 1,
      session,
      progress: null,
      error: null,
    });
    const finished = await syncLinkedInContacts("owner");
    expect(browserUpstream.mock.calls[1][1]).toEqual(progress);
    expect(finished.account?.contacts).toEqual(contacts);
    expect(finished.importing).toBe(false);
    expect(JSON.stringify(finished.account)).not.toContain("cookies");
    expect(JSON.stringify(finished)).not.toContain("secret-browser-cookie");
  });
  it("keeps credentials out of public status and scopes data to its owner", async () => {
    const status = await connectLinkedInContacts("owner", "secret-token");
    expect(JSON.stringify(status)).not.toContain("secret-token");
    expect([...files.values()][0]).not.toContain("secret-token");
    expect((await linkedInContactsStatus("other-user")).connected).toBe(false);
  });
  it("runs daily and catches up after downtime without fetching on every scheduler tick", async () => {
    vi.useFakeTimers();
    await connectLinkedInContacts("owner", "secret-token");
    await syncDueLinkedInContacts();
    expect(upstream).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 2 * 86_400_000);
    await syncDueLinkedInContacts();
    await syncDueLinkedInContacts();
    expect(upstream).toHaveBeenCalledTimes(2);
  });
  it("preserves saved contacts on failed sync and stops expired-token retries until reconnect", async () => {
    vi.useFakeTimers();
    await connectLinkedInContacts("owner", "secret-token");
    vi.setSystemTime(Date.now() + 86_400_001);
    upstream.mockRejectedValue(
      new LinkedInSnapshotError(401, "Reconnect required"),
    );
    const status = await syncLinkedInContacts("owner");
    expect(status.account?.contacts).toHaveLength(1);
    expect(status.requiresReconnect).toBe(true);
    await syncDueLinkedInContacts();
    expect(upstream).toHaveBeenCalledTimes(2);
  });
  it("does not overwrite a working connection when a replacement token is denied", async () => {
    await connectLinkedInContacts("owner", "working-token");
    upstream.mockRejectedValue(new LinkedInSnapshotError(403, "Access denied"));
    await expect(connectLinkedInContacts("owner", "bad-token")).rejects.toThrow(
      "Access denied",
    );
    expect(
      (await linkedInContactsStatus("owner")).account?.contacts,
    ).toHaveLength(1);
  });
  it("retains an authorized preparation state and retries later, then deletes data on disconnect", async () => {
    vi.useFakeTimers();
    upstream.mockRejectedValue(
      new LinkedInSnapshotError(404, "Preparing snapshot"),
    );
    expect(
      (await connectLinkedInContacts("owner", "secret-token")).connected,
    ).toBe(true);
    await syncDueLinkedInContacts();
    expect(upstream).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 900_001);
    upstream.mockResolvedValue({ contacts: [], pages: 1 });
    await syncDueLinkedInContacts();
    expect((await linkedInContactsStatus("owner")).error).toBeNull();
    await disconnectLinkedInContacts("owner");
    expect(files.size).toBe(0);
    expect((await linkedInContactsStatus("owner")).connected).toBe(false);
  });
});
