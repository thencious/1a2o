(() => {
  const frame = document.getElementById("workspace");
  for (const name of ["tasks", "notes"])
    document.getElementById(name).onclick = () => {
      for (const tab of ["tasks", "notes"])
        document
          .getElementById(tab)
          .setAttribute("aria-pressed", String(tab === name));
      frame.title = name === "notes" ? "Notes" : "Tasks";
      frame.src = `${name === "notes" ? "notes.html" : "index.html"}?offline=1`;
    };
  // Hydrate both local copies after pairing, even before either tab is visited.
  async function hydrate(workspace) {
    const key = workspace === "notes" ? "zenro.notes.v1" : "still.tasks.v1",
      dirty =
        workspace === "notes"
          ? "zenro.notes.dirty"
          : "open-inbox-zero.todo.dirty",
      baseline =
        workspace === "notes"
          ? "zenro.notes.baseline"
          : "zenro.tasks.saved-baseline",
      revision =
        workspace === "notes"
          ? "zenro.notes.revision"
          : "open-inbox-zero.todo.revision";
    try {
      const requestedRevision = localStorage.getItem(revision);
      const response = await fetch(
        `/api/user/todo/state?workspace=${workspace}`,
        { cache: "no-store", signal: AbortSignal.timeout(5000) },
      );
      if (!response.ok) return;
      const remote = await response.json();
      const { mergeWorkspaceItems } = await import("./workspace-data.mjs");
      if (localStorage.getItem(revision) !== requestedRevision) return;
      const local = JSON.parse(localStorage.getItem(key) || "[]"),
        base = JSON.parse(localStorage.getItem(baseline) || "[]");
      const merged = mergeWorkspaceItems(base, local, remote.tasks);
      localStorage.setItem(key, JSON.stringify(merged));
      localStorage.setItem(baseline, JSON.stringify(remote.tasks));
      localStorage.setItem(revision, remote.revision);
      if (JSON.stringify(merged) !== JSON.stringify(remote.tasks))
        localStorage.setItem(dirty, "true");
      if (
        frame.contentWindow?.location.pathname.endsWith(
          workspace === "notes" ? "/notes.html" : "/index.html",
        )
      )
        frame.contentWindow.dispatchEvent(
          new CustomEvent(
            workspace === "notes" ? "zenro-notes-merge" : "zenro-tasks-merge",
            { detail: merged },
          ),
        );
    } catch {}
  }
  hydrate("tasks");
  hydrate("notes");
  window.Onea2oCloud?.hydrateAll();
})();
