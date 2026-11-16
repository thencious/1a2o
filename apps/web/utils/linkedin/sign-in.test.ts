import { beforeEach, describe, expect, it, vi } from "vitest";
const { spawn, accept } = vi.hoisted(() => ({
  spawn: vi.fn(),
  accept: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("node:child_process", () => ({ spawn }));
vi.mock("node:fs", () => ({ existsSync: () => true }));
vi.mock("@/env", () => ({ env: { LOCAL_BEEPER_OWNER_ID: "owner" } }));
vi.mock("./contacts", () => ({ acceptLinkedInBrowserSession: accept }));
import { EventEmitter } from "node:events";
import {
  startLinkedInSignIn,
  cancelLinkedInSignIn,
  linkedInSignInStatus,
} from "./sign-in";

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      zenroLinkedInSignIns?: Map<string, unknown>;
    }
  ).zenroLinkedInSignIns?.clear();
  spawn.mockReset();
  accept.mockReset();
  accept.mockResolvedValue({ connected: true });
  spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      connected: true,
      disconnect: vi.fn(),
    });
    child.disconnect.mockImplementation(() => {
      child.connected = false;
    });
    return child;
  });
});
describe("desktop LinkedIn sign-in", () => {
  it("allows only the installation owner to open a local window and prevents duplicate windows", () => {
    expect(() => startLinkedInSignIn("another-user")).toThrow("owner");
    expect(spawn).not.toHaveBeenCalled();
    startLinkedInSignIn("owner");
    startLinkedInSignIn("owner");
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0][2]).toMatchObject({
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
  });
  it("accepts session credentials only over its own child IPC, without exposing them in status", async () => {
    startLinkedInSignIn("owner");
    const child = spawn.mock.results[0].value;
    const session = {
      userAgent: "Fixture browser user agent",
      csrf: "ajax:secret",
      cookies: ["li_at", "JSESSIONID"].map((name) => ({
        name,
        value: "private-session-cookie",
        domain: ".linkedin.com",
        path: "/",
        expires: -1,
      })),
    };
    child.emit("message", { type: "session", session });
    await vi.waitFor(() =>
      expect(linkedInSignInStatus("owner")?.phase).toBe("connected"),
    );
    expect(accept).toHaveBeenCalledWith("owner", session);
    expect(JSON.stringify(linkedInSignInStatus("owner"))).not.toContain(
      "private-session-cookie",
    );
  });
  it("ignores late session messages after cancellation", () => {
    startLinkedInSignIn("owner");
    const child = spawn.mock.results[0].value;
    cancelLinkedInSignIn("owner");
    child.emit("message", { type: "session", session: {} });
    expect(accept).not.toHaveBeenCalled();
    expect(linkedInSignInStatus("owner")?.phase).toBe("cancelled");
    expect(child.disconnect).toHaveBeenCalledTimes(1);
  });
  it("handles an unavailable browser and invalid cookies without saving credentials", async () => {
    startLinkedInSignIn("owner");
    const child = spawn.mock.results[0].value;
    child.emit("message", { type: "session", session: {} });
    await vi.waitFor(() =>
      expect(linkedInSignInStatus("owner")?.phase).toBe("error"),
    );
    expect(accept).not.toHaveBeenCalled();
    child.emit("error", new Error("private internal details"));
    expect(JSON.stringify(linkedInSignInStatus("owner"))).not.toContain(
      "private internal details",
    );
  });
});
