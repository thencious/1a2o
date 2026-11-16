import { describe, expect, it } from "vitest";
import { googleEventPermissions } from "./google-event-permissions";

describe("Google calendar edit and delete capabilities", () => {
  it("allows deleting an event from Gmail without pretending its protected details are editable", () => {
    expect(
      googleEventPermissions(
        {
          eventType: "fromGmail",
          organizer: { self: true, email: "me@example.com" },
          status: "confirmed",
        },
        true,
      ),
    ).toMatchObject({
      editable: false,
      deletable: true,
      readOnlyReason: expect.stringContaining("automatically from Gmail"),
    });
  });
  it("allows removing a spam invitation from a writable calendar without allowing organizer edits", () => {
    expect(
      googleEventPermissions(
        { organizer: { email: "someone@example.com" }, status: "confirmed" },
        true,
      ),
    ).toMatchObject({ editable: false, deletable: true });
  });
  it("preserves a guest's explicit modification permission", () => {
    expect(
      googleEventPermissions(
        { organizer: { email: "someone@example.com" }, guestsCanModify: true },
        true,
      ).editable,
    ).toBe(true);
  });
  it("does not allow deletion on read-only calendars or of already cancelled events", () => {
    expect(
      googleEventPermissions(
        { eventType: "fromGmail", organizer: { self: true } },
        false,
      ).deletable,
    ).toBe(false);
    expect(
      googleEventPermissions({ status: "cancelled" }, true).deletable,
    ).toBe(false);
  });
});
