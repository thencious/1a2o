import { describe, expect, it } from "vitest";
import { rememberedWorkspaceHref, workspaceSection } from "./location";
describe("workspace navigation history", () => {
  it("restores the last view and query for a tab without crossing mail accounts", () => {
    const locations = new Map([
      ["/one/mail", "/one/mail?accountScope=all&split=receipt&thread=123"],
      ["/one/automation", "/one/automation?domain=tasks"],
    ]);
    expect(
      rememberedWorkspaceHref(
        "/one/mail?accountScope=all&split=all",
        locations,
      ),
    ).toBe("/one/mail?accountScope=all&split=receipt&thread=123");
    expect(rememberedWorkspaceHref("/two/mail", locations)).toBe("/two/mail");
    expect(rememberedWorkspaceHref("/one/automation", locations)).toBe(
      "/one/automation?domain=tasks",
    );
  });
  it("resumes unfinished rule editors from the Rules navigation rather than Chat", () => {
    expect(workspaceSection("/one/assistant/rule/create")).toBe(
      "/one/automation",
    );
    expect(workspaceSection("/one/assistant/rule/existing")).toBe(
      "/one/automation",
    );
    expect(workspaceSection("/one/assistant")).toBe("/one/assistant");
  });
  it("keeps global settings and discussions separate from account tabs", () => {
    expect(workspaceSection("/settings")).toBe("/settings");
    expect(workspaceSection("/shared/discussion")).toBe("/shared");
  });
  it("does not rewrite external or protocol-relative links", () => {
    const locations = new Map([["/one/mail", "/one/mail?private-view=1"]]);
    expect(
      rememberedWorkspaceHref("https://example.com/one/mail", locations),
    ).toBe("https://example.com/one/mail");
    expect(rememberedWorkspaceHref("//example.com/one/mail", locations)).toBe(
      "//example.com/one/mail",
    );
  });
});
