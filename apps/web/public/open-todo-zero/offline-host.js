(() => {
  window.WorkspaceEditor = function WorkspaceEditor(options) {
    if (window.WorkspaceMarkdownEditor) {
      try {
        return new window.WorkspaceMarkdownEditor(options);
      } catch (error) {
        options.el.replaceChildren();
        window.dispatchEvent(
          new CustomEvent("onea2o-editor-fallback", {
            detail: {
              message:
                error instanceof Error ? error.message : "Editor unavailable",
            },
          }),
        );
      }
    }
    return new window.toastui.Editor(options);
  };
  if (!crypto.randomUUID)
    crypto.randomUUID = () => {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const s = Array.from(bytes, (value) =>
        value.toString(16).padStart(2, "0"),
      ).join("");
      return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
    };
  if (new URL(location.href).searchParams.get("offline") !== "1") return;
  const workspace = location.pathname.endsWith("/notes.html")
    ? "notes"
    : "tasks";
  const key = workspace === "notes" ? "zenro.notes.v1" : "still.tasks.v1";
  const dirtyKey =
    workspace === "notes" ? "zenro.notes.dirty" : "open-inbox-zero.todo.dirty";
  const revisionKey =
    workspace === "notes"
      ? "zenro.notes.revision"
      : "open-inbox-zero.todo.revision";
  const baselineKey =
    workspace === "notes"
      ? "zenro.notes.baseline"
      : "zenro.tasks.saved-baseline";
  if (!localStorage.getItem(key)) localStorage.setItem(key, "[]");
  if (!localStorage.getItem(baselineKey))
    localStorage.setItem(baselineKey, "[]");
  const bootstrap = {
    workspace,
    revision: localStorage.getItem(revisionKey) || "initial",
    tasks: JSON.parse(localStorage.getItem(key) || "[]"),
    aiAvailable: false,
    preferences: {},
  };
  if (!document.getElementById("inbox-todo-bootstrap")) {
    const element = document.createElement("script");
    element.id = "inbox-todo-bootstrap";
    element.type = "application/json";
    element.textContent = JSON.stringify(bootstrap);
    document.head.append(element);
  }
  let syncing = false,
    timer;
  const read = () => JSON.parse(localStorage.getItem(key) || "[]");
  const status = (value) => {
    const element = document.getElementById("storage-status");
    if (element)
      element.textContent =
        window.Onea2oCloud?.displayStatus(workspace, value) || value;
  };
  const unavailable = () =>
    Promise.reject(
      new Error(
        "This feature needs the connected host. Your work remains saved on this device.",
      ),
    );
  function save(tasks) {
    const previous = new Map(read().map((item) => [item.id, item]));
    for (const task of tasks)
      if (
        JSON.stringify({ ...task, updatedAt: undefined }) !==
        JSON.stringify({ ...previous.get(task.id), updatedAt: undefined })
      )
        task.updatedAt = Date.now();
    localStorage.setItem(key, JSON.stringify(tasks));
    localStorage.setItem(dirtyKey, "true");
    window.Onea2oCloud?.changed(workspace);
    status("Saved on this device - sync pending");
    clearTimeout(timer);
    timer = setTimeout(sync, 750);
  }
  async function fetchState() {
    const response = await fetch(
      `/api/user/todo/state?workspace=${workspace}`,
      { cache: "no-store", signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) throw new Error("Host unavailable");
    return response.json();
  }
  async function sync() {
    if (syncing) return;
    syncing = true;
    const requestedRevision = localStorage.getItem(revisionKey);
    try {
      const remote = await fetchState();
      const { mergeWorkspaceItems } = await import("./workspace-data.mjs");
      if (localStorage.getItem(revisionKey) !== requestedRevision) {
        timer = setTimeout(sync, 750);
        return;
      }
      const base = JSON.parse(localStorage.getItem(baselineKey) || "[]");
      const local = read(),
        merged = mergeWorkspaceItems(base, local, remote.tasks);
      localStorage.setItem(baselineKey, JSON.stringify(remote.tasks));
      localStorage.setItem(revisionKey, remote.revision);
      localStorage.setItem(key, JSON.stringify(merged));
      if (JSON.stringify(merged) !== JSON.stringify(local))
        window.dispatchEvent(
          new CustomEvent(
            workspace === "notes" ? "zenro-notes-merge" : "zenro-tasks-merge",
            { detail: merged },
          ),
        );
      if (JSON.stringify(merged) !== JSON.stringify(remote.tasks)) {
        const payload = JSON.stringify(merged);
        const response = await fetch("/api/user/todo/offline", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspace,
            revision: remote.revision,
            tasks: merged,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Sync will retry");
        localStorage.setItem(revisionKey, result.revision);
        localStorage.setItem(baselineKey, payload);
        if (localStorage.getItem(key) === payload)
          localStorage.removeItem(dirtyKey);
      } else localStorage.removeItem(dirtyKey);
      status(
        localStorage.getItem(dirtyKey) === "true"
          ? "Saved on this device - syncing changes"
          : "Saved on device and host",
      );
    } catch {
      status("Saved on this device - waiting for connection");
    } finally {
      syncing = false;
    }
  }
  window.InboxTodoHost = {
    offline: true,
    windowsNotifications: false,
    initial: read,
    save,
    flush: sync,
    aiEnabled: () => false,
    setAI() {},
    policy: () => ({
      autoAnalyze: false,
      estimateWork: false,
      urgentEnabled: true,
      urgentHours: 12,
      remindersEnabled: false,
      manualOverrides: true,
    }),
    analyze: unavailable,
    calendar: unavailable,
    configureNtfy: unavailable,
    syncReminders: async () => null,
    async addToNotes(task) {
      const k = "zenro.notes.v1",
        items = JSON.parse(localStorage.getItem(k) || "[]"),
        id = `task-note-${task.id}`;
      if (items.some((item) => item.id === id)) return { existing: true };
      items.unshift({
        id,
        title: task.title,
        notes: `# ${task.title}\n\n${task.notes || ""}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      localStorage.setItem(k, JSON.stringify(items));
      localStorage.setItem("zenro.notes.dirty", "true");
      return { existing: false };
    },
    addTask: unavailable,
  };
  window.addEventListener("onea2o-cloud-merge", (event) => {
    if (event.detail.workspace !== workspace) return;
    window.dispatchEvent(
      new CustomEvent(
        workspace === "notes" ? "zenro-notes-merge" : "zenro-tasks-merge",
        { detail: event.detail.items },
      ),
    );
    sync();
  });
  window.addEventListener("online", sync);
  window.addEventListener("focus", sync);
  setInterval(sync, 10_000);
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      status("Saved on this device");
      sync();
    },
    { once: true },
  );
})();
