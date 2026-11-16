(() => {
  if (window.InboxTodoHost?.offline) return;
  const bootstrap = JSON.parse(
    document.getElementById("inbox-todo-bootstrap").textContent,
  );
  const key = "zenro.notes.v1",
    revisionKey = "zenro.notes.revision",
    dirtyKey = "zenro.notes.dirty";
  const requests = new Map();
  let revision = bootstrap.revision,
    baseline = structuredClone(bootstrap.tasks),
    pending = null,
    busy = false,
    conflict = false,
    refreshBusy = false,
    timer;
  try {
    const local = localStorage.getItem(key);
    if (!local) {
      localStorage.setItem(key, JSON.stringify(baseline));
      localStorage.setItem(revisionKey, revision);
      localStorage.setItem("zenro.notes.baseline", JSON.stringify(baseline));
    } else {
      revision = localStorage.getItem(revisionKey) || revision;
      baseline = JSON.parse(
        localStorage.getItem("zenro.notes.baseline") ||
          JSON.stringify(baseline),
      );
      if (localStorage.getItem(dirtyKey) === "true")
        pending = JSON.parse(local);
    }
  } catch {}
  function call(type, input) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID(),
        timer = setTimeout(
          () => {
            requests.delete(id);
            reject(
              new Error(
                "Request timed out. Your note is saved on this device.",
              ),
            );
          },
          type === "analyze" ? 270_000 : 180_000,
        );
      requests.set(id, { resolve, reject, timer });
      parent.postMessage(
        { channel: "inbox-todo", type, id, input },
        location.origin,
      );
    });
  }
  window.addEventListener("message", (event) => {
    if (
      event.origin !== location.origin ||
      event.source !== parent ||
      event.data?.channel !== "inbox-todo-result"
    )
      return;
    const job = requests.get(event.data.id);
    if (!job) return;
    requests.delete(event.data.id);
    clearTimeout(job.timer);
    if (event.data.error) job.reject(new Error(event.data.error));
    else job.resolve(event.data.data);
  });
  const channel =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel("zenro-note-task-transfer")
      : null;
  function status(message) {
    const element = document.getElementById("storage-status");
    if (element)
      element.textContent =
        window.Onea2oCloud?.displayStatus("notes", message) || message;
  }
  async function refresh() {
    if (busy) {
      setTimeout(refresh, 800);
      return;
    }
    if (refreshBusy) return;
    refreshBusy = true;
    const requestedRevision = revision;
    try {
      const response = await fetch("/api/user/todo/state?workspace=notes", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Could not refresh notes.");
      const state = await response.json();
      if (state.revision === revision) return;
      const { mergeWorkspaceItems } = await import("./workspace-data.mjs");
      // A save may finish while this GET is in flight. Its older response
      // cannot be reconciled against the newer acknowledgement baseline.
      if (busy || revision !== requestedRevision) {
        setTimeout(refresh, 800);
        return;
      }
      const local = JSON.parse(localStorage.getItem(key) || "[]"),
        merged = mergeWorkspaceItems(baseline, local, state.tasks);
      revision = state.revision;
      baseline = structuredClone(state.tasks);
      conflict = false;
      localStorage.setItem("zenro.notes.baseline", JSON.stringify(baseline));
      localStorage.setItem(revisionKey, revision);
      localStorage.setItem(key, JSON.stringify(merged));
      window.dispatchEvent(
        new CustomEvent("zenro-notes-merge", { detail: merged }),
      );
      pending =
        JSON.stringify(merged) !== JSON.stringify(state.tasks)
          ? structuredClone(merged)
          : null;
      if (pending) await flush();
      else {
        localStorage.removeItem(dirtyKey);
        status("Saved");
      }
    } catch (error) {
      conflict = true;
      status(error.message);
    } finally {
      refreshBusy = false;
    }
  }
  async function flush() {
    clearTimeout(timer);
    timer = null;
    if (busy || !pending || conflict) return;
    // Editor objects keep changing while the request waits for a response.
    // Only the detached document actually sent can become the saved baseline.
    const tasks = structuredClone(pending);
    pending = null;
    busy = true;
    try {
      const result = await call("save", { revision, tasks });
      revision = result.revision;
      baseline = tasks;
      localStorage.setItem("zenro.notes.baseline", JSON.stringify(baseline));
      localStorage.setItem(revisionKey, revision);
      if (!pending) {
        localStorage.removeItem(dirtyKey);
        status("Saved");
      }
    } catch (error) {
      pending = pending || tasks;
      status(`Saved on this device · ${error.message}`);
      if (error.message.includes("changed in another window"))
        setTimeout(refresh, 0);
      else timer = setTimeout(flush, 15_000);
    } finally {
      busy = false;
      if (pending && !timer && !conflict) timer = setTimeout(flush, 750);
    }
  }
  window.InboxTodoHost = {
    initial: () =>
      JSON.parse(localStorage.getItem(key) || JSON.stringify(bootstrap.tasks)),
    save(tasks) {
      localStorage.setItem(key, JSON.stringify(tasks));
      window.Onea2oCloud?.changed("notes");
      localStorage.setItem(dirtyKey, "true");
      pending = structuredClone(tasks);
      clearTimeout(timer);
      timer = setTimeout(flush, 500);
    },
    aiEnabled: () => bootstrap.aiAvailable,
    policy: () => bootstrap.preferences?.policy || { estimateWork: true },
    setAI() {},
    async analyze(request) {
      const result = await call("analyze", { request });
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { "Content-Type": "application/json" },
      });
    },
    async addTask(note, task) {
      const result = await call("note-to-task", { noteId: note.id, task });
      channel?.postMessage({ workspace: "tasks" });
      return result;
    },
    async calendar(taskId) {
      return call("calendar", { taskId });
    },
    flush,
  };
  if (channel)
    channel.onmessage = (event) => {
      if (event.data?.workspace === "notes") refresh();
    };
  window.addEventListener("onea2o-cloud-merge", (event) => {
    if (event.detail.workspace !== "notes") return;
    pending = structuredClone(event.detail.items);
    localStorage.setItem(dirtyKey, "true");
    window.dispatchEvent(
      new CustomEvent("zenro-notes-merge", { detail: event.detail.items }),
    );
    flush();
  });
  window.addEventListener("focus", refresh);
  setTimeout(async () => {
    await refresh();
    if (pending) flush();
  }, 0);
  setInterval(refresh, 15_000);
  window.addEventListener("online", () => {
    refresh();
    flush();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flush();
    else refresh();
  });
})();
