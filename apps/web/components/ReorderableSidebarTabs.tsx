"use client";

import {
  type ReactNode,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  insertTab,
  orderedTabs,
  parseTabOrder,
} from "@/utils/workspace/tab-order";

const storageKey = "zenro:sidebar-tab-order:v1";
const changeEvent = "zenro-sidebar-tab-order";
const dragType = "application/x-zenro-sidebar-tab";

export function ReorderableSidebarTabs({
  items,
}: {
  items: {
    id: string;
    name: string;
    handle: ReactNode;
    children?: ReactNode;
  }[];
}) {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const savedOrder = useMemo(() => {
    const ids = parseTabOrder(raw);
    if (!ids.includes("contacts") && ids.includes("messages")) {
      ids.splice(ids.indexOf("messages") + 1, 0, "contacts");
    }
    return ids;
  }, [raw]);
  const [unsaved, setUnsaved] = useState<string[] | null>(null);
  const android = useSyncExternalStore(
    subscribePlatform,
    () => /1a2o-Android\//.test(navigator.userAgent),
    () => false,
  );
  const ordered = orderedTabs(
    items.filter((item) => !android || item.id !== "agents"),
    unsaved ?? savedOrder,
  );
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<{
    id: string;
    side: "before" | "after";
  } | null>(null);
  const activeDrag = useRef<string | null>(null);
  const control = useRef(false);
  const clickAfter = useRef(0);
  const [announcement, setAnnouncement] = useState("");
  const finish = () => {
    activeDrag.current = null;
    setDragging(null);
    setTarget(null);
    clickAfter.current = Date.now() + 150;
  };

  return (
    <nav
      data-section-navigation
      data-reorderable-tabs
      aria-label="Main navigation"
      className="mt-3 flex flex-col gap-px"
    >
      {ordered.map((item) => (
        <div
          key={item.id}
          data-sidebar-tab={item.id}
          className={`relative ${dragging === item.id ? "opacity-50" : ""}`}
          onDragOver={(event) => {
            if (!activeDrag.current) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            const rect = event.currentTarget.getBoundingClientRect();
            setTarget({
              id: item.id,
              side:
                event.clientY < rect.top + rect.height / 2 ? "before" : "after",
            });
          }}
          onDragLeave={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              setTarget(null);
          }}
          onDrop={(event) => {
            const source = activeDrag.current;
            if (
              !source ||
              !target ||
              target.id !== item.id ||
              event.dataTransfer.getData(dragType) !== source
            )
              return;
            event.preventDefault();
            event.stopPropagation();
            const ids = insertTab(
              ordered.map((item) => item.id),
              source,
              target.id,
              target.side,
            );
            try {
              localStorage.setItem(storageKey, JSON.stringify(ids));
              setUnsaved(null);
              window.dispatchEvent(new Event(changeEvent));
            } catch {
              setUnsaved(ids);
            }
            setAnnouncement(
              `${items.find((item) => item.id === source)?.name ?? source} moved to position ${ids.indexOf(source) + 1}`,
            );
            finish();
          }}
        >
          {target && target.id === item.id && dragging !== item.id && (
            <span
              aria-hidden="true"
              data-tab-insertion={target.side}
              className="pointer-events-none absolute left-1 right-1 z-30 h-0.5 rounded-full bg-foreground/70"
              style={target.side === "before" ? { top: -1 } : { bottom: -1 }}
            />
          )}
          <div
            data-tab-handle
            draggable
            title={`Drag to reorder ${item.name}`}
            className="cursor-grab select-none active:cursor-grabbing"
            onPointerDownCapture={(event) => {
              control.current =
                item.id !== "tools" &&
                !!(event.target as Element).closest(
                  "button,input,select,textarea",
                );
            }}
            onDragStart={(event) => {
              if (control.current) {
                event.preventDefault();
                return;
              }
              activeDrag.current = item.id;
              setDragging(item.id);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData(dragType, item.id);
            }}
            onDragEnd={finish}
            onClickCapture={(event) => {
              if (activeDrag.current || Date.now() < clickAfter.current) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
          >
            {item.handle}
          </div>
          {item.children}
        </div>
      ))}
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </nav>
  );
}

function snapshot() {
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}
function subscribe(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === storageKey || event.key === null) listener();
  };
  window.addEventListener("storage", storage);
  window.addEventListener(changeEvent, listener);
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener(changeEvent, listener);
  };
}

function subscribePlatform() {
  return () => {};
}
