import { useEffect, useRef, useState } from "react";
import styles from "./EmailEditor.module.css";

export type RenderedPreservedEmailBlock = {
  id: string;
  kind: "quote" | "signature";
  previewHtml: string;
  // The signature wrapped in the editor's signature container.
  editableHtml?: string;
};

export type ActivePreservedBlock = Pick<
  RenderedPreservedEmailBlock,
  "id" | "kind"
>;

// Signature and quote share one "â‹¯" toggle so the composer reads like a plain
// email body with hidden trailing content, not a stack of labelled sections.
export function PreservedBlocksToggle({
  blocks,
  expanded,
  onToggle,
}: {
  blocks: ActivePreservedBlock[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const hiddenContent = [
    blocks.some((candidate) => candidate.kind === "signature") && "signature",
    blocks.some((candidate) => candidate.kind === "quote") && "quoted message",
  ]
    .filter(Boolean)
    .join(" and ");

  return (
    <button
      aria-expanded={expanded}
      aria-label={`${expanded ? "Hide" : "Show"} ${hiddenContent}`}
      className={styles.preservedToggle}
      onClick={onToggle}
      onMouseDown={(event) => event.preventDefault()}
      type="button"
    >
      â‹¯
    </button>
  );
}

// Nothing in a quote preview may reach the network, even if the sanitizer
// misses something.
const PREVIEW_CONTENT_POLICY =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'";

export function QuotePreview({ previewHtml }: { previewHtml: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [palette, setPalette] = useState<{
    background: string;
    color: string;
    dark: boolean;
  } | null>(null);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const sync = () => {
      let background = "";
      for (let host = frame.parentElement; host; host = host.parentElement) {
        const candidate = getComputedStyle(host).backgroundColor;
        if (
          candidate &&
          candidate !== "transparent" &&
          candidate !== "rgba(0, 0, 0, 0)"
        ) {
          background = candidate;
          break;
        }
      }
      const scheme = getComputedStyle(
        frame.parentElement ?? document.documentElement,
      ).colorScheme;
      const dark =
        !!frame.closest(".dark") ||
        scheme === "dark" ||
        (scheme !== "light" &&
          scheme !== "dark" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
      const next = {
        background: background || (dark ? "#202020" : "#fff"),
        color: getComputedStyle(frame).color,
        dark,
      };
      setPalette((current) =>
        current?.background === next.background &&
        current?.color === next.color &&
        current?.dark === next.dark
          ? current
          : next,
      );
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    const account = frame.closest(".mail-account-theme");
    if (account)
      observer.observe(account, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    return () => observer.disconnect();
  }, []);
  return (
    <iframe
      ref={frameRef}
      className={styles.quotePreview}
      sandbox=""
      style={{
        visibility: palette ? "visible" : "hidden",
        colorScheme: palette?.dark ? "dark" : "light",
        background: palette?.background,
      }}
      srcDoc={
        palette ? buildQuotePreviewDocument(previewHtml, palette) : undefined
      }
      tabIndex={-1}
      title="Quoted message preview"
    />
  );
}

function buildQuotePreviewDocument(
  previewHtml: string,
  palette: { background: string; color: string; dark: boolean },
) {
  const doc = new DOMParser().parseFromString(previewHtml, "text/html");
  const policy = doc.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = PREVIEW_CONTENT_POLICY;
  const css = doc.createElement("style");
  css.textContent =
    'html,body{margin:0;padding:0;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{padding:8px}img{max-width:100%;height:auto}table{max-width:100%}';
  doc.head.prepend(policy, css);
  doc.documentElement.style.setProperty(
    "color-scheme",
    palette.dark ? "dark" : "light",
    "important",
  );
  doc.documentElement.style.setProperty(
    "background",
    palette.background,
    "important",
  );
  if (palette.dark) {
    for (const element of doc.querySelectorAll<HTMLElement>("body, body *")) {
      if (!element.style || element.closest("svg")) continue;
      element.style.setProperty("background", "transparent", "important");
      element.style.setProperty("color", "inherit", "important");
      element.style.setProperty(
        "-webkit-text-fill-color",
        "currentColor",
        "important",
      );
    }
  }
  doc.body.style.setProperty("background", palette.background, "important");
  doc.body.style.setProperty("color", palette.color, "important");
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
