import { describe, expect, it, vi } from "vitest";
import {
  linkedInBrowserSession,
  parseConnectionsPage,
  readBrowserConnections,
} from "./voyager";

const session = () => ({
  userAgent: "Fixture browser user agent",
  csrf: "ajax:test-csrf",
  cookies: [
    {
      name: "li_at",
      value: "private-session-value",
      domain: ".linkedin.com",
      path: "/",
      expires: -1,
    },
    {
      name: "JSESSIONID",
      value: '"ajax:test-csrf"',
      domain: ".linkedin.com",
      path: "/",
      expires: -1,
    },
  ],
});
function page(start: number, count: number) {
  const rows = Array.from({ length: count }, (_, i) => {
    const id = start + i;
    return [
      {
        entityUrn: `connection:${id}`,
        createdAt: 1_770_000_000_000,
        "*connectedMemberResolutionResult": `profile:${id}`,
      },
      {
        entityUrn: `profile:${id}`,
        firstName: { text: `Person ${id}`, attributes: [] },
        lastName: "Example",
        publicIdentifier: `person-${id}`,
        headline: { text: "Engineer", attributes: [] },
      },
    ];
  });
  return {
    data: {
      "*elements": rows.map((pair) => pair[0].entityUrn),
      paging: { total: 1000, start, count: 40 },
    },
    included: [
      ...rows.flat(),
      {
        entityUrn: "unrelated",
        firstName: "Do not import",
        lastName: "This person",
      },
    ],
  };
}
const options = { pause: async () => {} };

describe("direct LinkedIn connections", () => {
  it("retains unavailable LinkedIn members instead of aborting the entire import", () => {
    const result = parseConnectionsPage({
      data: { "*elements": ["connection:private"] },
      included: [
        {
          entityUrn: "connection:private",
          connectedMember: "urn:li:fsd_profile:unavailable",
          createdAt: 1_770_000_000_000,
          $type: "com.linkedin.voyager.dash.relationships.Connection",
        },
      ],
    });
    expect(result.rowCount).toBe(1);
    expect(result.contacts[0]).toMatchObject({
      id: "urn:li:fsd_profile:unavailable",
      name: "LinkedIn member",
      profileUnavailable: true,
    });
  });
  it("resolves only listed connections, including attributed text and profile URLs", () => {
    const result = parseConnectionsPage(page(0, 2));
    expect(result.contacts).toHaveLength(2);
    expect(result.contacts[0]).toMatchObject({
      id: "profile:0",
      name: "Person 0 Example",
      position: "Engineer",
      profileUrl: "https://www.linkedin.com/in/person-0",
    });
  });
  it("continues beyond 1000 and does not truncate at an inaccurate reported total", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const offset = Number(new URL(String(input)).searchParams.get("start"));
      return Response.json(
        page(offset, Math.min(40, Math.max(0, 1201 - offset))),
      );
    });
    const result = await readBrowserConnections(session(), null, {
      ...options,
      fetcher,
      budgetPages: 40,
    });
    expect(result.complete).toBe(true);
    expect(result.contacts).toHaveLength(1201);
    expect(fetcher).toHaveBeenCalledTimes(32);
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      redirect: "manual",
      headers: {
        "csrf-token": "ajax:test-csrf",
        "User-Agent": "Fixture browser user agent",
      },
    });
  });
  it("resumes from the saved offset across batches", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const offset = Number(new URL(String(input)).searchParams.get("start"));
      return Response.json(page(offset, offset >= 80 ? 0 : 40));
    });
    const first = await readBrowserConnections(session(), null, {
      ...options,
      fetcher,
      budgetPages: 1,
    });
    expect(first.progress?.start).toBe(40);
    const second = await readBrowserConnections(first.session, first.progress, {
      ...options,
      fetcher,
      budgetPages: 3,
    });
    expect(second.complete).toBe(true);
    expect(second.contacts).toHaveLength(80);
  });
  it("checkpoints pages before a rate limit and honors Retry-After", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(page(0, 40)))
      .mockResolvedValueOnce(
        Response.json({}, { status: 429, headers: { "retry-after": "7200" } }),
      );
    const result = await readBrowserConnections(session(), null, {
      ...options,
      fetcher,
    });
    expect(result.error).toMatchObject({
      status: 429,
      retryAfterMs: 7_200_000,
    });
    expect(result.progress?.start).toBe(40);
    expect(result.progress?.contacts).toHaveLength(40);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("stops at sign-in redirects without sending session cookies to another origin", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.redirect("https://example.org/", 302));
    const result = await readBrowserConnections(session(), null, {
      ...options,
      fetcher,
    });
    expect(result.error?.status).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("refuses repeated and unresolved pages instead of publishing incomplete contacts", async () => {
    const repeated = await readBrowserConnections(session(), null, {
      ...options,
      fetcher: vi
        .fn<typeof fetch>()
        .mockImplementation(async () => Response.json(page(0, 40))),
    });
    expect(repeated.complete).toBe(false);
    expect(repeated.error?.message).toContain("repeated");
    expect(() =>
      parseConnectionsPage({
        data: { "*elements": ["missing"] },
        included: [],
      }),
    ).toThrow("resolved");
    expect(() => parseConnectionsPage({ data: {} })).toThrow("format changed");
  });
  it("updates rotating cookies and stops expired sessions locally", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(page(0, 1), {
          headers: {
            "set-cookie":
              "li_at=rotated-private-value; Path=/; Secure; HttpOnly",
          },
        }),
      )
      .mockResolvedValueOnce(Response.json(page(1, 0)));
    const result = await readBrowserConnections(session(), null, {
      ...options,
      fetcher,
    });
    expect(
      result.session.cookies.find((cookie) => cookie.name === "li_at")?.value,
    ).toBe("rotated-private-value");
    expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({
      Cookie: expect.stringContaining("li_at=rotated-private-value"),
    });
    const expired = session();
    expired.cookies[0].expires = 1;
    const never = vi.fn<typeof fetch>();
    expect(
      (
        await readBrowserConnections(expired, null, {
          ...options,
          fetcher: never,
        })
      ).error?.status,
    ).toBe(401);
    expect(never).not.toHaveBeenCalled();
  });
  it("rejects cookies outside LinkedIn and header injection", () => {
    const invalid = session();
    invalid.cookies[0].domain = ".example.org";
    expect(linkedInBrowserSession.safeParse(invalid).success).toBe(false);
    expect(
      linkedInBrowserSession.safeParse({
        ...session(),
        csrf: "x\r\nInjected: value",
      }).success,
    ).toBe(false);
  });
});
