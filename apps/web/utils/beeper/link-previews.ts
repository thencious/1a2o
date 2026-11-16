import "server-only";
import { getPreviewFromContent } from "link-preview-js";
import { safePublicFetch } from "@/utils/mcp/safe-fetch";
import type { ChatLinkPreview } from "./types";
import { webLinkUrl } from "./message-links";

const cache = new Map<
  string,
  { expires: number; value: Promise<ChatLinkPreview> }
>();

export async function completeLinkPreview(
  preview: ChatLinkPreview,
): Promise<ChatLinkPreview> {
  if (preview.title && (preview.description || preview.image)) return preview;
  const url = webLinkUrl(preview.url);
  if (!url) return preview;
  const existing = cache.get(url);
  if (existing && existing.expires > Date.now())
    return mergePreview(preview, await existing.value);
  const value: Promise<ChatLinkPreview> = fetchPreview(url).catch(() => ({
    url,
    title: "",
  }));
  if (cache.size >= 500) cache.delete(cache.keys().next().value!);
  const entry = { expires: Date.now() + 86_400_000, value };
  cache.set(url, entry);
  const fetched = await value;
  if (!fetched.title && !fetched.image) entry.expires = Date.now() + 600_000;
  return mergePreview(preview, fetched);
}

export async function fetchPreviewImage(url: string) {
  const response = await fetchPublicResource(
    url,
    "image/avif,image/webp,image/png,image/jpeg,image/gif",
  );
  const type =
    response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() ?? "";
  if (!/^image\/(png|jpeg|webp|avif|gif)$/.test(type)) {
    await response.body?.cancel();
    throw new Error("Unsupported preview image");
  }
  const body = await readBoundedBody(response, 5_000_000);
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

async function fetchPreview(url: string): Promise<ChatLinkPreview> {
  const response = await fetchPublicResource(
    url,
    "text/html,application/xhtml+xml",
  );
  const contentType = response.headers.get("content-type") ?? "";
  if (!/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(contentType)) {
    await response.body?.cancel();
    return { url, title: "" };
  }
  const html = new TextDecoder().decode(
    await readBoundedBody(response, 1_000_000),
  );
  const result = await getPreviewFromContent({
    url: response.url || url,
    status: response.status,
    headers: Object.fromEntries(response.headers),
    data: html,
  });
  return {
    url,
    title: "title" in result ? result.title.slice(0, 500) : "",
    description:
      "description" in result ? result.description?.slice(0, 1000) : undefined,
    image:
      "images" in result
        ? result.images.find((image) => webLinkUrl(image))
        : undefined,
  };
}

async function fetchPublicResource(value: string, accept: string) {
  const url = new URL(value);
  // Prefer HTTPS for previews; the clickable message keeps its original URL.
  if (url.protocol === "http:") url.protocol = "https:";
  const signal = AbortSignal.timeout(8000);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await safePublicFetch(url.href, {
      signal,
      headers: { Accept: accept, "User-Agent": "1a2o Link Preview" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || redirects === 3)
        throw new Error("Preview redirect limit");
      const target = new URL(location, url);
      if (!webLinkUrl(target.href) || target.protocol !== "https:")
        throw new Error("Unsupported preview redirect");
      url.href = target.href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Preview unavailable");
    }
    return response;
  }
  throw new Error("Preview unavailable");
}

async function readBoundedBody(response: Response, limit: number) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw new Error("Preview resource too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function mergePreview(
  native: ChatLinkPreview,
  fetched: ChatLinkPreview,
): ChatLinkPreview {
  return {
    url: native.url,
    title: native.title || fetched.title,
    description: native.description || fetched.description,
    image: native.image || fetched.image,
  };
}
