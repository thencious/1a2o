import { afterEach, expect, it, vi } from "vitest";
import { resolve } from "node:path";
vi.mock("server-only", () => ({}));
import { localWorkspaceRoot } from "./local-workspace";

afterEach(() => vi.restoreAllMocks());
it("uses the same local data directory from the web app and repository working directories", () => {
  const app = process.cwd();
  const root = resolve(app, "../..");
  expect(localWorkspaceRoot()).toBe(root);
  vi.spyOn(process, "cwd").mockReturnValue(root);
  expect(localWorkspaceRoot()).toBe(root);
});
