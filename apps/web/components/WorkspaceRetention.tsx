"use client";
import {
  Activity,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ContextType,
} from "react";
import { WorkspacePageContext } from "@/components/WorkspacePageContext";
import { usePathname, useSearchParams } from "next/navigation";
import {
  PathnameContext,
  SearchParamsContext,
  PathParamsContext,
} from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { LayoutRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import {
  EmailAccountSnapshotProvider,
  useAccount,
} from "@/providers/EmailAccountProvider";
import {
  rememberedWorkspaceHref,
  workspaceSection,
} from "@/utils/workspace/location";
import {
  captureWorkspaceFocus,
  restoreWorkspaceDom,
  workspaceOwns,
  type WorkspaceDomState,
} from "@/utils/workspace/dom-state";

type RouteSnapshot = {
  pathname: ReturnType<typeof usePathname>;
  search: ContextType<typeof SearchParamsContext>;
  params: ContextType<typeof PathParamsContext>;
  layout: ContextType<typeof LayoutRouterContext>;
};
type Entry = { node: ReactNode; route: RouteSnapshot };
type RetentionContext = {
  entries: ReadonlyMap<string, Entry>;
  register: (key: string, entry: Entry) => void;
  locations: ReadonlyMap<string, string>;
  activePathname: string;
  reveal: (href: string) => void;
};
const Retention = createContext<RetentionContext | null>(null);

export function WorkspaceRetentionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [entries, setEntries] = useState(new Map<string, Entry>());
  const [locations, setLocations] = useState(new Map<string, string>());
  const pathname = usePathname(),
    search = useSearchParams().toString();
  const [pending, setPending] = useState<{
    from: string;
    to: string;
  } | null>(null);
  if (pending && pending.from !== pathname) setPending(null);
  const activePathname = pending?.from === pathname ? pending.to : pathname;
  const reveal = useCallback(
    (href: string) => {
      const target = href.split(/[?#]/, 1)[0];
      setPending(
        target !== pathname && entries.has(target)
          ? { from: pathname, to: target }
          : null,
      );
    },
    [entries, pathname],
  );
  const register = useCallback((key: string, entry: Entry) => {
    setEntries((previous) =>
      previous.get(key)?.node === entry.node &&
      previous.get(key)?.route.search === entry.route.search &&
      previous.get(key)?.route.params === entry.route.params &&
      previous.get(key)?.route.layout === entry.route.layout
        ? previous
        : new Map(previous).set(key, entry),
    );
  }, []);
  useLayoutEffect(() => {
    const href = pathname + (search ? `?${search}` : "");
    const section = workspaceSection(pathname);
    setLocations((previous) =>
      previous.get(section) === href
        ? previous
        : new Map(previous).set(section, href),
    );
  }, [pathname, search]);
  const value = useMemo(
    () => ({ entries, locations, register, activePathname, reveal }),
    [entries, locations, register, activePathname, reveal],
  );
  return <Retention.Provider value={value}>{children}</Retention.Provider>;
}
export function useRevealWorkspace() {
  const context = useContext(Retention);
  return context?.reveal;
}
export function useVisibleWorkspacePathname() {
  const pathname = usePathname();
  const context = useContext(Retention);
  return context?.activePathname ?? pathname;
}
export function useWorkspaceHref(href: string) {
  const context = useContext(Retention);
  return context ? rememberedWorkspaceHref(href, context.locations) : href;
}
export function useWorkspaceNavigation() {
  const context = useContext(Retention);
  return useCallback(
    (href: string) =>
      context ? rememberedWorkspaceHref(href, context.locations) : href,
    [context?.locations, context],
  );
}
export function RetainedWorkspaceRoute({ children }: { children: ReactNode }) {
  const context = useContext(Retention);
  const pathname = usePathname();
  const search = useContext(SearchParamsContext),
    params = useContext(PathParamsContext),
    layout = useContext(LayoutRouterContext);
  const register = context?.register;
  useLayoutEffect(() => {
    register?.(pathname, {
      node: children,
      route: { pathname, search, params, layout },
    });
  }, [register, pathname, children, search, params, layout]);
  return context ? null : children;
}
export function WorkspaceRetentionOutlet({
  children,
}: {
  children: ReactNode;
}) {
  const context = useContext(Retention);
  if (!context) return children;
  const activePathname = context.activePathname;
  return (
    <>
      <div
        className="contents"
        style={
          context.entries.has(activePathname) ? { display: "none" } : undefined
        }
      >
        {children}
      </div>
      {[...context.entries].map(([key, entry]) => (
        <WorkspacePanel
          key={key}
          entry={entry}
          active={key === activePathname}
        />
      ))}
    </>
  );
}
function WorkspacePanel({ entry, active }: { entry: Entry; active: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const state = useRef<WorkspaceDomState>({ scroll: new Map() });
  const visible = useRef(active);
  visible.current = active;
  const interaction = useRef(0);
  const previousActive = useRef(active),
    restoring = useRef(false);
  if (previousActive.current !== active) {
    previousActive.current = active;
    restoring.current = active;
  }
  const account = useAccount(),
    accountSnapshot = useRef(account);
  if (active) accountSnapshot.current = account;
  useEffect(() => {
    const container = root.current;
    if (!container) return;
    state.current.root = container;
    const documents = new Map<Document, () => void>(),
      frames = new Map<HTMLIFrameElement, () => void>();
    const bindDocument = (doc: Document) => {
      if (documents.has(doc)) return;
      const focus = (event: Event) => {
        const element = event.target as HTMLElement;
        if (element?.tagName === "A" && element.closest("aside,nav")) return;
        if (element?.closest("[data-section-group]")) return;
        if (
          visible.current &&
          !restoring.current &&
          element?.nodeType === 1 &&
          workspaceOwns(container, element)
        )
          captureWorkspaceFocus(state.current, element);
      };
      const selection = () => {
        const element = doc.activeElement;
        if (
          visible.current &&
          !restoring.current &&
          element &&
          workspaceOwns(container, element)
        )
          captureWorkspaceFocus(state.current, element);
      };
      const pointer = () => {
        interaction.current++;
        if (visible.current) restoring.current = false;
        selection();
      };
      const scroll = (event: Event) => {
        if (!visible.current || restoring.current) return;
        const target = event.target;
        if (target === doc) {
          const view = doc.defaultView;
          if (view)
            state.current.scroll.set(view, {
              x: view.scrollX,
              y: view.scrollY,
            });
        } else if (
          (target as Node)?.nodeType === 1 &&
          workspaceOwns(container, target as Node)
        ) {
          const element = target as HTMLElement;
          state.current.scroll.set(element, {
            x: element.scrollLeft,
            y: element.scrollTop,
          });
        }
      };
      doc.addEventListener("focusin", focus, true);
      doc.addEventListener("focusout", focus, true);
      doc.addEventListener("selectionchange", selection);
      doc.addEventListener("pointerdown", pointer, true);
      doc.addEventListener("keydown", pointer, true);
      doc.addEventListener("scroll", scroll, true);
      documents.set(doc, () => {
        doc.removeEventListener("focusin", focus, true);
        doc.removeEventListener("focusout", focus, true);
        doc.removeEventListener("selectionchange", selection);
        doc.removeEventListener("pointerdown", pointer, true);
        doc.removeEventListener("keydown", pointer, true);
        doc.removeEventListener("scroll", scroll, true);
      });
    };
    const bindFrames = () => {
      for (const frame of container.querySelectorAll<HTMLIFrameElement>(
        "iframe",
      )) {
        if (frames.has(frame)) continue;
        const load = () => {
          try {
            if (frame.contentDocument) bindDocument(frame.contentDocument);
          } catch {}
        };
        frame.addEventListener("load", load);
        frames.set(frame, () => frame.removeEventListener("load", load));
        load();
      }
    };
    bindDocument(document);
    bindFrames();
    const observer = new MutationObserver(bindFrames);
    observer.observe(container, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      for (const unbind of frames.values()) unbind();
      for (const unbind of documents.values()) unbind();
    };
  }, []);
  useLayoutEffect(() => {
    if (!active) return;
    const version = interaction.current;
    return restoreWorkspaceDom(
      state.current,
      () => !visible.current || interaction.current !== version,
      () => {
        restoring.current = false;
      },
    );
  }, [active]);
  return (
    <div
      ref={root}
      data-workspace-page={entry.route.pathname}
      data-workspace-active={active ? "true" : "false"}
      className="contents"
      style={active ? undefined : { display: "none" }}
    >
      <WorkspacePageContext.Provider value={entry.route.pathname}>
        <PathnameContext.Provider value={entry.route.pathname}>
          <SearchParamsContext.Provider value={entry.route.search}>
            <PathParamsContext.Provider value={entry.route.params}>
              <LayoutRouterContext.Provider value={entry.route.layout}>
                <EmailAccountSnapshotProvider value={accountSnapshot.current}>
                  <Activity mode={active ? "visible" : "hidden"}>
                    {entry.node}
                  </Activity>
                </EmailAccountSnapshotProvider>
              </LayoutRouterContext.Provider>
            </PathParamsContext.Provider>
          </SearchParamsContext.Provider>
        </PathnameContext.Provider>
      </WorkspacePageContext.Provider>
    </div>
  );
}
