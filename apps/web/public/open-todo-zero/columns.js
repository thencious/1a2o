(() => {
  function initializeColumns() {
    const workspace = document.querySelector(".workspace");
    if (!workspace) return;
    const noteMode =
      JSON.parse(document.getElementById("inbox-todo-bootstrap").textContent)
        .workspace === "notes";
    const key = noteMode
      ? "zenro.notes.columns.v1"
      : "open-inbox-zero.todo.columns.v1";
    let preferred = 50,
      dragging = false;
    try {
      const stored = Number(localStorage.getItem(key));
      if (stored >= 20 && stored <= 80) preferred = stored;
    } catch {}
    const divider = document.createElement("div");
    divider.className = "todo-column-divider";
    divider.tabIndex = 0;
    divider.setAttribute("role", "separator");
    divider.setAttribute("aria-orientation", "vertical");
    divider.setAttribute(
      "aria-label",
      noteMode ? "Resize note columns" : "Resize task columns",
    );
    divider.title = "Drag to resize task columns. Arrow keys also work.";
    function bounds() {
      const width = workspace.getBoundingClientRect().width;
      return {
        min: Math.min(45, Math.max(20, (260 / width) * 100)),
        max: Math.max(55, Math.min(80, 100 - (300 / width) * 100)),
      };
    }
    function layout() {
      const { min, max } = bounds(),
        value = Math.max(min, Math.min(max, preferred));
      workspace.style.setProperty("--todo-list-width", `${value}%`);
      divider.setAttribute("aria-valuemin", String(Math.round(min)));
      divider.setAttribute("aria-valuemax", String(Math.round(max)));
      divider.setAttribute("aria-valuenow", String(Math.round(value)));
    }
    function save() {
      try {
        localStorage.setItem(key, String(preferred));
      } catch {}
    }
    function finish() {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("todo-column-resizing");
      save();
    }
    divider.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      dragging = true;
      divider.focus({ preventScroll: true });
      divider.setPointerCapture(event.pointerId);
      document.body.classList.add("todo-column-resizing");
    });
    divider.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      event.preventDefault();
      const rect = workspace.getBoundingClientRect(),
        { min, max } = bounds();
      preferred = Math.max(
        min,
        Math.min(max, ((event.clientX - rect.left) / rect.width) * 100),
      );
      layout();
    });
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
      divider.addEventListener(name, finish);
    divider.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      event.stopPropagation();
      const { min, max } = bounds();
      preferred =
        event.key === "Home"
          ? min
          : event.key === "End"
            ? max
            : Math.max(
                min,
                Math.min(
                  max,
                  preferred +
                    (event.key === "ArrowLeft" ? -1 : 1) *
                      (event.shiftKey ? 5 : 1),
                ),
              );
      layout();
      save();
    });
    workspace.append(divider);
    new ResizeObserver(layout).observe(workspace);
    layout();
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", initializeColumns, {
      once: true,
    });
  else initializeColumns();
})();
