import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { BeeperContact } from "@/utils/beeper/contact-types";
import { LinkedInSnapshotError } from "./snapshot";

export const linkedInBrowserSession = z
  .object({
    userAgent: z
      .string()
      .min(10)
      .max(1000)
      .regex(/^[^\r\n]+$/),
    csrf: z
      .string()
      .min(1)
      .max(1000)
      .regex(/^[^\r\n]+$/),
    cookies: z
      .array(
        z.object({
          name: z
            .string()
            .min(1)
            .max(128)
            .regex(/^[a-zA-Z0-9_-]+$/),
          value: z
            .string()
            .max(8192)
            .regex(/^[^;\r\n]*$/),
          domain: z
            .string()
            .refine(
              (domain) =>
                domain === "linkedin.com" ||
                domain === ".linkedin.com" ||
                domain === "www.linkedin.com" ||
                domain === ".www.linkedin.com",
            ),
          path: z.string().startsWith("/"),
          expires: z.number(),
        }),
      )
      .max(80),
  })
  .refine(
    (session) =>
      ["li_at", "JSESSIONID"].every((name) =>
        session.cookies.some((cookie) => cookie.name === name && cookie.value),
      ),
    "LinkedIn sign-in is incomplete.",
  );

export type ConnectionProgress = {
  contacts: BeeperContact[];
  start: number;
  pages: number;
  fingerprints: string[];
};

export async function readBrowserConnections(
  input: z.infer<typeof linkedInBrowserSession>,
  progress?: ConnectionProgress | null,
  {
    fetcher = fetch,
    pause = () => delay(2000),
    budgetPages = 20,
  }: {
    fetcher?: typeof fetch;
    pause?: () => Promise<unknown>;
    budgetPages?: number;
  } = {},
) {
  const session = linkedInBrowserSession.parse(structuredClone(input));
  const state: ConnectionProgress = progress
    ? structuredClone(progress)
    : { contacts: [], start: 0, pages: 0, fingerprints: [] };
  const contacts = new Map(
    state.contacts.map((contact) => [contact.id, contact]),
  );
  const deadline = AbortSignal.timeout(180_000);
  try {
    for (let attempt = 0; attempt < budgetPages; attempt++) {
      if (state.pages >= 1000)
        throw new LinkedInSnapshotError(
          502,
          "LinkedIn connections pagination did not finish. Saved contacts are retained.",
        );
      const url = new URL(
        "https://www.linkedin.com/voyager/api/relationships/dash/connections",
      );
      for (const [key, value] of Object.entries({
        count: "40",
        start: String(state.start),
        q: "search",
        sortType: "RECENTLY_ADDED",
        decorationId:
          "com.linkedin.voyager.dash.deco.web.mynetwork.ConnectionListWithProfile-16",
      }))
        url.searchParams.set(key, value);
      const now = Date.now() / 1000;
      const cookies = session.cookies.filter(
        (cookie) =>
          (cookie.expires <= 0 || cookie.expires > now) &&
          url.pathname.startsWith(cookie.path),
      );
      if (!cookies.some((cookie) => cookie.name === "li_at"))
        throw new LinkedInSnapshotError(
          401,
          "Your LinkedIn session expired. Sign in again to resume contacts sync.",
        );
      const response = await fetcher(url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        headers: {
          Cookie: cookies
            .map((cookie) => `${cookie.name}=${cookie.value}`)
            .join("; "),
          "csrf-token": session.csrf,
          "User-Agent": session.userAgent,
          Accept: "application/vnd.linkedin.normalized+json+2.1",
          "X-RestLi-Protocol-Version": "2.0.0",
          Referer:
            "https://www.linkedin.com/mynetwork/invite-connect/connections/",
        },
        signal: AbortSignal.any([deadline, AbortSignal.timeout(25_000)]),
      });
      if ([301, 302, 303, 307, 308, 401, 403, 999].includes(response.status)) {
        await response.body?.cancel();
        throw new LinkedInSnapshotError(
          401,
          "LinkedIn needs you to sign in or complete verification. Reconnect to continue; saved contacts are retained.",
        );
      }
      if (!response.ok) {
        const header = response.headers.get("retry-after");
        const wait =
          header && /^\d+$/.test(header)
            ? Number(header) * 1000
            : Date.parse(header ?? "") - Date.now();
        await response.body?.cancel();
        throw new LinkedInSnapshotError(
          response.status,
          response.status === 429
            ? "LinkedIn requested a pause. Sync will resume automatically; saved contacts are retained."
            : `LinkedIn contacts returned HTTP ${response.status}. Sync will retry automatically.`,
          Math.max(
            response.status === 429 ? 3_600_000 : 900_000,
            Number.isFinite(wait) ? wait : 0,
          ),
        );
      }
      updateCookies(session, response.headers.getSetCookie());
      const body: unknown = await response.json().catch(() => null);
      const parsed = parseConnectionsPage(body);
      if (!parsed.rowCount)
        return {
          complete: true as const,
          contacts: [...contacts.values()],
          pages: state.pages,
          session,
          progress: null,
          error: null,
        };
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(parsed.contacts.map((contact) => contact.id)))
        .digest("hex");
      if (state.fingerprints.includes(fingerprint))
        throw new LinkedInSnapshotError(
          502,
          "LinkedIn repeated a connections page. Sync stopped without replacing your saved contacts.",
        );
      state.fingerprints.push(fingerprint);
      for (const contact of parsed.contacts) contacts.set(contact.id, contact);
      state.start += parsed.rowCount;
      state.pages++;
      state.contacts = [...contacts.values()];
      if (attempt + 1 < budgetPages) await pause();
    }
    return {
      complete: false as const,
      contacts: [...contacts.values()],
      pages: state.pages,
      session,
      progress: state,
      error: null,
    };
  } catch (error) {
    const known =
      error instanceof LinkedInSnapshotError
        ? error
        : new LinkedInSnapshotError(
            0,
            "Could not reach LinkedIn. Sync will resume automatically; saved contacts are retained.",
          );
    return {
      complete: false as const,
      contacts: [...contacts.values()],
      pages: state.pages,
      session,
      progress: state,
      error: {
        status: known.status,
        message: known.message,
        retryAfterMs: known.retryAfterMs,
      },
    };
  }
}

export function parseConnectionsPage(body: unknown) {
  const value = z
    .object({
      data: z.record(z.string(), z.unknown()).optional(),
      elements: z.array(z.unknown()).optional(),
      included: z.array(z.record(z.string(), z.unknown())).optional(),
    })
    .safeParse(body);
  if (!value.success)
    throw new LinkedInSnapshotError(
      502,
      "LinkedIn returned an unexpected contacts response. Saved contacts are retained.",
    );
  const root: Record<string, unknown> = value.data.data ?? value.data;
  const refs = root["*elements"] ?? root.elements;
  if (!Array.isArray(refs))
    throw new LinkedInSnapshotError(
      502,
      "LinkedIn’s connections format changed. Saved contacts are retained.",
    );
  const records = new Map(
    (value.data.included ?? []).map((record) => [record.entityUrn, record]),
  );
  const contacts = refs.map((ref) => {
    const connection = typeof ref === "string" ? records.get(ref) : ref;
    if (!connection || typeof connection !== "object")
      throw new LinkedInSnapshotError(
        502,
        "A LinkedIn connection could not be resolved. Saved contacts are retained.",
      );
    const item = connection as Record<string, unknown>;
    const profileRef =
      item["*connectedMemberResolutionResult"] ??
      item["*miniProfile"] ??
      item.connectedMember;
    const profile = (
      typeof profileRef === "string"
        ? records.get(profileRef)
        : (item.connectedMemberResolutionResult ?? item.miniProfile ?? item)
    ) as Record<string, unknown> | undefined;
    const unavailable =
      !profile &&
      typeof item.connectedMember === "string" &&
      item.connectedMember.startsWith("urn:li:fsd_profile:");
    const name = unavailable
      ? "LinkedIn member"
      : [text(profile?.firstName), text(profile?.lastName)]
          .filter(Boolean)
          .join(" ");
    const urn =
      text(profile?.entityUrn) ||
      (unavailable ? text(item.connectedMember) : text(item.entityUrn));
    if (!name || !urn)
      throw new LinkedInSnapshotError(
        502,
        "A LinkedIn contact is missing its identity. Saved contacts are retained.",
      );
    const identifier = text(profile?.publicIdentifier);
    const createdAt =
      typeof item.createdAt === "number" && Number.isFinite(item.createdAt)
        ? item.createdAt
        : null;
    return {
      id: urn,
      name,
      username: identifier || undefined,
      profileUrl: identifier
        ? `https://www.linkedin.com/in/${encodeURIComponent(identifier)}`
        : undefined,
      position:
        text(profile?.headline) || text(profile?.occupation) || undefined,
      connectedOn:
        createdAt && !Number.isNaN(new Date(createdAt).getTime())
          ? new Date(createdAt).toISOString().slice(0, 10)
          : undefined,
      cannotMessage: true,
      profileUnavailable: unavailable || undefined,
    } satisfies BeeperContact;
  });
  return { contacts, rowCount: refs.length };
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (
    value &&
    typeof value === "object" &&
    "text" in value &&
    typeof value.text === "string"
  )
    return value.text.trim();
  return "";
}
function updateCookies(
  session: z.infer<typeof linkedInBrowserSession>,
  headers: string[],
) {
  for (const header of headers) {
    const [pair, ...attributes] = header.split(";");
    const equal = pair.indexOf("=");
    const name = pair.slice(0, equal),
      value = pair.slice(equal + 1);
    const previous = session.cookies.find((cookie) => cookie.name === name);
    if (equal <= 0 || !previous || /[\r\n]/.test(value)) continue;
    let expires = previous.expires;
    for (const attribute of attributes) {
      const [key, ...parts] = attribute.trim().split("=");
      if (key.toLowerCase() === "max-age" && /^-?\d+$/.test(parts.join("=")))
        expires = Date.now() / 1000 + Number(parts.join("="));
      if (
        key.toLowerCase() === "expires" &&
        Number.isFinite(Date.parse(parts.join("=")))
      )
        expires = Date.parse(parts.join("=")) / 1000;
    }
    previous.value = value;
    previous.expires = expires;
    if (name === "JSESSIONID") session.csrf = value.replace(/^"|"$/g, "");
  }
}
