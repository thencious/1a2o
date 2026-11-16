import { describe, expect, it, vi } from "vitest";
import { readLinkedInConnections } from "./snapshot";

const row = (name: string, url = `https://www.linkedin.com/in/${name}`) => ({
  "First Name": name,
  "Last Name": "Example",
  URL: url,
  Company: "Example Ltd",
  Position: "Engineer",
  "Connected On": "01 Jan 2026",
});
const page = (rows: unknown[]) =>
  Response.json({
    paging: { start: 0, count: 10, total: 1 },
    elements: [{ snapshotDomain: "CONNECTIONS", snapshotData: rows }],
  });
const end = () =>
  Response.json(
    { message: "No data found for this domain and memberId." },
    { status: 404 },
  );

describe("LinkedIn connections snapshot", () => {
  it("continues past inaccurate totals, deduplicates overlaps, and reads more than 1000 connections", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        page(Array.from({ length: 700 }, (_, i) => row(`person-${i}`))),
      )
      .mockResolvedValueOnce(
        page(Array.from({ length: 502 }, (_, i) => row(`person-${i + 699}`))),
      )
      .mockResolvedValueOnce(end());
    const result = await readLinkedInConnections("private-test-token", fetcher);
    expect(result.contacts).toHaveLength(1201);
    expect(result.pages).toBe(2);
    expect(
      fetcher.mock.calls.map(([url]) =>
        new URL(String(url)).searchParams.get("start"),
      ),
    ).toEqual(["0", "1", "2"]);
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({
      "LinkedIn-Version": "202312",
    });
    expect(result.contacts[0]).toMatchObject({
      name: "person-0 Example",
      company: "Example Ltd",
      position: "Engineer",
      cannotMessage: true,
    });
  });
  it("does not mistake a missing API resource for successful end of pagination", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(page([row("one")]))
      .mockResolvedValueOnce(
        Response.json(
          { message: "No virtual resource found" },
          { status: 404 },
        ),
      );
    await expect(
      readLinkedInConnections("test", fetcher),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("detects repeated pages instead of looping or publishing a partial directory", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => page([row("one")]));
    await expect(readLinkedInConnections("test", fetcher)).rejects.toThrow(
      "repeated",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("treats first-page no-data as preparation, and an explicit empty snapshot as empty", async () => {
    await expect(
      readLinkedInConnections(
        "test",
        vi.fn<typeof fetch>().mockResolvedValue(end()),
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (
        await readLinkedInConnections(
          "test",
          vi.fn<typeof fetch>().mockResolvedValue(page([])),
        )
      ).contacts,
    ).toEqual([]);
  });
  it("rejects malformed snapshots and excludes unsafe profile links", async () => {
    await expect(
      readLinkedInConnections(
        "test",
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(Response.json({ elements: [] })),
      ),
    ).rejects.toMatchObject({ status: 502 });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(page([row("one", "javascript:alert(1)")]))
      .mockResolvedValueOnce(end());
    expect(
      (await readLinkedInConnections("test", fetcher)).contacts[0].profileUrl,
    ).toBeUndefined();
  });
  it("does not retain raw upstream errors or credentials", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { message: "private-test-token private contact" },
          { status: 403 },
        ),
      );
    await expect(
      readLinkedInConnections("private-test-token", fetcher),
    ).rejects.toThrow("denied connections access");
    const limited = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({}, { status: 429, headers: { "retry-after": "3600" } }),
      );
    await expect(
      readLinkedInConnections("test", limited),
    ).rejects.toMatchObject({ status: 429, retryAfterMs: 3_600_000 });
  });
});
