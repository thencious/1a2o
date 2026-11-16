import { createHash } from "node:crypto";
import { z } from "zod";
import type { BeeperContact } from "@/utils/beeper/contact-types";

const snapshotPage = z.object({
  elements: z.array(
    z.object({
      snapshotDomain: z.string(),
      snapshotData: z.array(z.record(z.string(), z.unknown())),
    }),
  ),
});

export class LinkedInSnapshotError extends Error {
  status: number;
  retryAfterMs: number;
  constructor(status: number, message: string, retryAfterMs = 0) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export async function readLinkedInConnections(
  token: string,
  fetcher: typeof fetch = fetch,
) {
  const contacts = new Map<string, BeeperContact>();
  const seenPages = new Set<string>();
  const deadline = AbortSignal.timeout(240_000);
  // LinkedIn documents start as a page number, not a row offset. Its total can be incomplete.
  for (let page = 0; page < 1000; page++) {
    const response = await fetcher(
      `https://api.linkedin.com/rest/memberSnapshotData?q=criteria&domain=CONNECTIONS&start=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "LinkedIn-Version": "202312",
          "X-Restli-Protocol-Version": "2.0.0",
        },
        signal: AbortSignal.any([deadline, AbortSignal.timeout(20_000)]),
        cache: "no-store",
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const noData =
        response.status === 404 &&
        typeof body?.message === "string" &&
        /no data found for (?:this domain and )?(?:this )?memberid/i.test(
          body.message,
        );
      if (noData && page > 0)
        return { contacts: [...contacts.values()], pages: page };
      if (noData)
        throw new LinkedInSnapshotError(
          404,
          "LinkedIn is still preparing your connections snapshot. It will be retried automatically.",
        );
      if (response.status === 401)
        throw new LinkedInSnapshotError(
          401,
          "LinkedIn authorization expired or was revoked. Replace the access token to resume sync.",
        );
      if (response.status === 403)
        throw new LinkedInSnapshotError(
          403,
          "LinkedIn denied connections access. Check EU/EEA/Switzerland eligibility and enable Member Data Portability API (Member) for your developer app.",
        );
      const retryHeader = response.headers.get("retry-after");
      const retry =
        retryHeader && /^\d+$/.test(retryHeader)
          ? Number(retryHeader) * 1000
          : Math.max(0, Date.parse(retryHeader ?? "") - Date.now());
      throw new LinkedInSnapshotError(
        response.status,
        `LinkedIn connections sync returned HTTP ${response.status}. Saved contacts are retained.`,
        Number.isFinite(retry) ? retry : 0,
      );
    }
    const parsed = snapshotPage.safeParse(body);
    if (
      !parsed.success ||
      !parsed.data.elements.length ||
      parsed.data.elements.some((item) => item.snapshotDomain !== "CONNECTIONS")
    )
      throw new LinkedInSnapshotError(
        502,
        "LinkedIn returned an unexpected connections snapshot. Saved contacts are retained.",
      );
    const rows = parsed.data.elements.flatMap((item) => item.snapshotData);
    if (!rows.length)
      return { contacts: [...contacts.values()], pages: page + 1 };
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(rows))
      .digest("hex");
    if (seenPages.has(fingerprint))
      throw new LinkedInSnapshotError(
        502,
        "LinkedIn repeated a connections page. Sync stopped without replacing your saved contacts.",
      );
    seenPages.add(fingerprint);
    for (const row of rows) {
      const contact = connectionFromRow(row);
      if (!contact)
        throw new LinkedInSnapshotError(
          502,
          "LinkedIn returned a connection without an identifiable name. Saved contacts are retained.",
        );
      contacts.set(contact.id, contact);
    }
  }
  throw new LinkedInSnapshotError(
    502,
    "LinkedIn pagination exceeded the safety limit. Saved contacts are retained.",
  );
}

function connectionFromRow(row: Record<string, unknown>): BeeperContact | null {
  const text = (key: string) =>
    typeof row[key] === "string" ? row[key].trim() : "";
  const name = [text("First Name"), text("Last Name")]
    .filter(Boolean)
    .join(" ");
  if (!name) return null;
  let profileUrl: string | undefined;
  try {
    const url = new URL(text("URL"));
    if (
      url.protocol === "https:" &&
      (url.hostname === "linkedin.com" ||
        url.hostname.endsWith(".linkedin.com")) &&
      url.pathname.startsWith("/in/")
    ) {
      profileUrl = `https://www.linkedin.com${url.pathname.replace(/\/$/, "")}`;
    }
  } catch {}
  const company = text("Company"),
    position = text("Position");
  const identity =
    profileUrl ??
    JSON.stringify([name, company, position, text("Connected On")]);
  return {
    id: `linkedin:${createHash("sha256").update(identity).digest("hex")}`,
    name,
    profileUrl,
    company,
    position,
    connectedOn: text("Connected On") || undefined,
    email: text("Email Address") || undefined,
    cannotMessage: true,
  };
}
