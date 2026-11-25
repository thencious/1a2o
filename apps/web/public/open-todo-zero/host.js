/* 1a2o host bridge. No provider keys cross into the frame. */
(() => {
  if (window.InboxTodoHost?.offline) return;
  const bootstrap = JSON.parse(
    document.getElementById("inbox-todo-bootstrap").textContent,
  );
  const taskKey = "still.tasks.v1",
    revisionKey = "open-inbox-zero.todo.revision",
    dirtyKey = "open-inbox-zero.todo.dirty",
    aiKey = "open-inbox-zero.todo.ai";
  let revision = bootstrap.revision,
    last = JSON.stringify(bootstrap.tasks),
    pending = null,
    busy = false,
    timer = null,
    conflict = false;
  const requests = new Map();
  const transferChannel =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel("zenro-note-task-transfer")
      : null;
  const baselineKey = "zenro.tasks.saved-baseline";
  let refreshBusy = false;
  try {
    const local = localStorage.getItem(taskKey);
    if (!local) {
      localStorage.setItem(taskKey, last);
      localStorage.setItem(revisionKey, revision);
      localStorage.setItem(baselineKey, last);
    } else {
      revision = localStorage.getItem(revisionKey) || revision;
      last = localStorage.getItem(baselineKey) || last;
      if (localStorage.getItem(dirtyKey) === "true") pending = local;
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
                type === "analyze"
                  ? "Deadline analysis timed out; check Usage before retrying."
                  : "Checklist backup is temporarily unavailable.",
              ),
            );
          },
          type === "analyze" ? 270_000 : type === "save" ? 30_000 : 180_000,
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
      event.origin === location.origin &&
      event.source === parent &&
      event.data?.channel === "inbox-todo-notice"
    ) {
      calendarStatus(event.data.message);
      return;
    }
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
  function status(text) {
    const element = document.getElementById("storage-status");
    if (element)
      element.textContent =
        window.Onea2oCloud?.displayStatus("tasks", text) || text;
  }
  async function flush() {
    clearTimeout(timer);
    timer = null;
    if (busy || pending === null || conflict) return;
    const payload = pending;
    pending = null;
    if (payload === last) {
      localStorage.removeItem(dirtyKey);
      status("Saved on device and in 1a2o");
      checkCalendars(JSON.parse(payload));
      return;
    }
    busy = true;
    try {
      const result = await call("save", {
        revision,
        tasks: JSON.parse(payload),
      });
      revision = result.revision;
      last = payload;
      localStorage.setItem(baselineKey, last);
      localStorage.setItem(revisionKey, revision);
      checkCalendars(JSON.parse(payload));
      if (pending === null) {
        localStorage.removeItem(dirtyKey);
        status("Saved on device and in 1a2o");
      }
    } catch (error) {
      pending = pending || payload;
      conflict = error.message.includes("changed in another window");
      status(
        conflict
          ? "Saved on this device · another window changed the backup"
          : "Saved on this device · backup will retry",
      );
      if (conflict) setTimeout(refreshExternal, 0);
      else timer = setTimeout(flush, 15_000);
    } finally {
      busy = false;
      if (pending !== null && !timer && !conflict)
        timer = setTimeout(flush, 500);
      if (pending === null) checkCalendars(JSON.parse(last));
    }
  }
  async function refreshExternal() {
    if (busy) {
      setTimeout(refreshExternal, 750);
      return;
    }
    if (refreshBusy) return;
    refreshBusy = true;
    const requestedRevision = revision;
    try {
      const response = await fetch("/api/user/todo/state", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Could not refresh Tasks.");
      const state = await response.json();
      if (state.revision === revision) return;
      const { mergeWorkspaceItems } = await import("./workspace-data.mjs");
      if (busy || revision !== requestedRevision) {
        setTimeout(refreshExternal, 750);
        return;
      }
      const merged = mergeWorkspaceItems(
        JSON.parse(last),
        JSON.parse(pending || localStorage.getItem(taskKey) || "[]"),
        state.tasks,
      );
      revision = state.revision;
      last = JSON.stringify(state.tasks);
      conflict = false;
      localStorage.setItem(revisionKey, revision);
      localStorage.setItem(baselineKey, last);
      localStorage.setItem(taskKey, JSON.stringify(merged));
      pending = JSON.stringify(merged) === last ? null : JSON.stringify(merged);
      if (pending) timer = setTimeout(flush, 500);
      else localStorage.removeItem(dirtyKey);
      window.dispatchEvent(
        new CustomEvent("zenro-tasks-merge", { detail: merged }),
      );
      checkCalendars(merged);
    } catch (error) {
      status(`Saved on this device ? ${error.message}`);
    } finally {
      refreshBusy = false;
    }
  }
  if (transferChannel)
    transferChannel.onmessage = (event) => {
      if (event.data?.workspace === "tasks") refreshExternal();
    };
  window.addEventListener("onea2o-cloud-merge", (event) => {
    if (event.detail.workspace !== "tasks") return;
    pending = JSON.stringify(event.detail.items);
    localStorage.setItem(dirtyKey, "true");
    window.dispatchEvent(
      new CustomEvent("zenro-tasks-merge", { detail: event.detail.items }),
    );
    flush();
  });
  window.addEventListener("focus", refreshExternal);
  window.addEventListener("online", () => {
    refreshExternal();
    flush();
  });
  setTimeout(async () => {
    await refreshExternal();
    if (pending) flush();
  }, 0);
  setInterval(refreshExternal, 15_000);
  window.InboxTodoHost = {
    windowsNotifications: bootstrap.windowsNotifications === true,
    async addToNotes(task) {
      const result = await call("task-to-note", task);
      transferChannel?.postMessage({ workspace: "notes" });
      return result;
    },
    save(tasks) {
      const originals = new Map(
        JSON.parse(last).map((item) => [item.id, item]),
      );
      for (const task of tasks)
        if (
          JSON.stringify({ ...task, updatedAt: undefined }) !==
          JSON.stringify({ ...originals.get(task.id), updatedAt: undefined })
        )
          task.updatedAt = Date.now();
      const payload = JSON.stringify(tasks);
      if (payload === last && pending === null) {
        checkCalendars(tasks);
        return;
      }
      pending = payload;
      localStorage.setItem(dirtyKey, "true");
      window.Onea2oCloud?.changed("tasks");
      if (!busy) {
        clearTimeout(timer);
        timer = setTimeout(flush, 500);
      }
    },
    policy: () =>
      bootstrap.preferences?.policy || {
        autoAnalyze: true,
        estimateWork: true,
        calendarTimed: true,
        calendarAllDay: true,
        urgentEnabled: true,
        urgentHours: 12,
        remindersEnabled: true,
        reminderLeadMinutes: 0,
        manualOverrides: true,
      },
    aiEnabled: () =>
      bootstrap.aiAvailable && localStorage.getItem(aiKey) !== "false",
    setAI(enabled) {
      localStorage.setItem(aiKey, String(enabled));
    },
    async analyze(request) {
      const result = await call("analyze", { request });
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { "Content-Type": "application/json" },
      });
    },

    async configureNtfy(topic, token) {
      await savePreferences({ ntfyTopic: topic, ntfyToken: token });
      sessionStorage.removeItem("still.ntfy.token");
      reminderChecked = 0;
    },
    async syncReminders() {
      if (reminderBusy || Date.now() - reminderChecked < 30_000) return null;
      reminderBusy = true;
      reminderChecked = Date.now();
      try {
        return await call("reminders", {});
      } finally {
        reminderBusy = false;
      }
    },
  };
  const checkedCalendars = new Map();
  let calendarBusy = false,
    reminderBusy = false,
    reminderChecked = 0;
  const preferences = bootstrap.preferences || {};
  if (preferences.ntfyTopic && !localStorage.getItem("still.alerts.v1"))
    localStorage.setItem(
      "still.alerts.v1",
      JSON.stringify({ topic: preferences.ntfyTopic }),
    );
  function calendarStatus(message, taskId, explain = false) {
    const element = document.getElementById("todo-calendar-status");
    if (!element) return;
    element.hidden = false;
    element.textContent = message;
    if (!explain) return;
    const link = (label, href, activate) => {
      const anchor = document.createElement("a");
      anchor.textContent = label;
      anchor.href = href;
      anchor.onclick = (event) => {
        event.preventDefault();
        activate();
      };
      return anchor;
    };
    const rulesUrl = new URL(parent.location.href);
    rulesUrl.pathname = `${rulesUrl.pathname.split("/todo")[0]}/automation`;
    rulesUrl.search = "?domain=tasks";
    rulesUrl.hash = "";
    element.append(
      " Check ",
      link("task timing", "#due-date", () =>
        window.dispatchEvent(
          new CustomEvent("onea2o-task-timing", { detail: { taskId } }),
        ),
      ),
      ", ",
      link("rules", rulesUrl.href, () => parent.location.assign(rulesUrl.href)),
      " and ",
      link("default calendar", "#todo-default-calendar", () => {
        document.getElementById("settings-open").click();
        document
          .getElementById("todo-default-calendar")
          .scrollIntoView({ block: "center" });
        document.getElementById("todo-calendar-mode").focus();
      }),
      ".",
    );
  }
  async function writableCalendars() {
    const response = await fetch("/api/user/calendar/catalog", {
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "Could not load calendars.");
    return {
      calendars: data.calendars.filter((item) => item.writable),
      warnings: data.warnings || [],
    };
  }
  function chooseCalendar(task) {
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.className = "todo-calendar-picker";
      dialog.setAttribute("aria-label", "Choose a calendar for this task");
      dialog.innerHTML =
        '<h2>Add task to a calendar</h2><p class="calendar-task-name"></p><p>Your task is saved. Choose where to add its deadline. We will check for existing events before adding it.</p><label>Calendar<select aria-label="Calendar for this task" required><option value="">Loading calendars...</option></select></label><label class="calendar-remember"><input type="checkbox" checked> Use this calendar by default for future tasks</label><p class="calendar-help">Uncheck to choose a calendar for each new task.</p><p role="status"></p><div class="settings-actions"><button type="button" data-action="cancel">Not now</button><button type="button" data-action="off">Keep tasks off calendar</button><button type="button" data-action="add" disabled>Add to calendar</button></div>';
      dialog.querySelector(".calendar-task-name").textContent = task.title;
      const select = dialog.querySelector("select"),
        remember = dialog.querySelector("input"),
        status = dialog.querySelector('[role="status"]'),
        add = dialog.querySelector('[data-action="add"]');
      remember.checked = preferences.calendarMode !== "ask";
      let result = null;
      select.onchange = () => {
        add.disabled = !select.value;
      };
      dialog.querySelector('[data-action="cancel"]').onclick = () =>
        dialog.close();
      dialog.querySelector('[data-action="off"]').onclick = async (event) => {
        event.target.disabled = true;
        try {
          await savePreferences({ calendarMode: "off" });
          dialog.close();
        } catch (error) {
          status.textContent = error.message;
          event.target.disabled = false;
        }
      };
      add.onclick = async () => {
        if (!select.value) return;
        add.disabled = true;
        try {
          const target = JSON.parse(select.value);
          await savePreferences(
            remember.checked
              ? { calendarMode: "default", defaultCalendar: target }
              : { calendarMode: "ask" },
          );
          result = target;
          dialog.close();
        } catch (error) {
          status.textContent = error.message;
          add.disabled = false;
        }
      };
      dialog.addEventListener(
        "close",
        () => {
          dialog.remove();
          resolve(result);
        },
        { once: true },
      );
      document.body.append(dialog);
      dialog.showModal();
      writableCalendars()
        .then((data) => {
          select.replaceChildren(new Option("Choose a calendar", ""));
          for (const calendar of data.calendars)
            select.add(
              new Option(
                `${calendar.name} (${calendar.accountEmail})`,
                JSON.stringify({
                  connectionId: calendar.connectionId,
                  calendarId: calendar.calendarId,
                }),
              ),
            );
          status.textContent = data.calendars.length
            ? data.warnings.join(" ")
            : "No editable calendars found. Connect a calendar and enable editing in Settings.";
        })
        .catch((error) => {
          status.textContent = error.message;
        });
    });
  }
  async function checkCalendars(tasks) {
    if (calendarBusy || busy || pending !== null) return;
    calendarBusy = true;
    try {
      for (const task of tasks) {
        if (
          task.completedAt ||
          (!task.deadlineOverride &&
            (task.aiState !== "success" ||
              !["event", "deadline"].includes(
                task.aiEvidence?.arguments?.calendar_kind,
              )))
        )
          continue;
        const policy = InboxTodoHost.policy();
        if (
          task.deadlineOverride ||
          task.aiEvidence?.arguments?.calendar_explicit_time
            ? !policy.calendarTimed
            : !policy.calendarAllDay
        )
          continue;
        const signature = JSON.stringify([
          task.title,
          task.aiEvidence?.arguments,
          task.deadlineOverride,
          task.deadline,
        ]);
        if (checkedCalendars.get(task.id) === signature) continue;
        try {
          let result = await call("calendar", { taskId: task.id });
          if (result.kind === "needs-calendar") {
            const target = await chooseCalendar(task);
            if (!target) {
              checkedCalendars.set(task.id, signature);
              continue;
            }
            result = await call("calendar", { taskId: task.id, target });
          }
          checkedCalendars.set(task.id, signature);
          calendarStatus(
            result.kind === "created"
              ? "Calendar event saved."
              : result.kind === "duplicate"
                ? "Calendar match found - review the update dialog."
                : result.kind === "disabled"
                  ? result.reason === "off"
                    ? "Calendar creation is turned off."
                    : "No calendar event was added."
                  : "Calendar checked.",
            task.id,
            result.kind === "disabled",
          );
        } catch (error) {
          calendarStatus(error.message || "Calendar check will retry.");
        }
      }
    } finally {
      calendarBusy = false;
    }
  }
  async function savePreferences(input) {
    const result = await call("preferences-save", {
      ...input,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    Object.assign(preferences, input);
    if (
      input.defaultCalendar !== undefined ||
      input.calendarMode !== undefined
    ) {
      checkedCalendars.clear();
      checkCalendars(JSON.parse(localStorage.getItem(taskKey) || "[]"));
    }
    return result;
  }
  function initializeSettings() {
    const dialog = document.getElementById("settings-dialog"),
      heading = document.createElement("h3");
    heading.textContent = "Calendar";
    const area = document.createElement("div");
    area.innerHTML =
      '<p>Automatically add AI-detected events and deadlines. Date-only tasks become all-day events. Existing events and tasks are checked before adding.</p><label for="todo-calendar-mode">Task calendars</label><select id="todo-calendar-mode"><option value="default">Use a default calendar</option><option value="ask">Choose for each new task</option><option value="off">Keep tasks off calendar</option></select><label for="todo-default-calendar">Default calendar for tasks</label><select id="todo-default-calendar"><option value="">Choose a default calendar</option></select><div class="settings-actions"><button id="todo-save-calendar">Save calendar</button></div><p id="todo-calendar-settings-status" role="status"></p>';
    dialog.append(heading, area);
    const notice = document.createElement("p");
    notice.id = "todo-calendar-status";
    notice.hidden = true;
    notice.setAttribute("role", "status");
    notice.style.cssText = "font-size:11px;color:#aaa;margin:0 0 8px";
    document.querySelector(".editor-box").before(notice);
    const modeSelect = document.getElementById("todo-calendar-mode");
    modeSelect.value =
      preferences.calendarMode ||
      (preferences.defaultCalendar ? "default" : "ask");
    const select = document.getElementById("todo-default-calendar"),
      status = document.getElementById("todo-calendar-settings-status");
    document
      .getElementById("settings-open")
      .addEventListener("click", async () => {
        document.getElementById("ntfy-token").placeholder =
          preferences.ntfyTokenConfigured
            ? "Stored securely - leave blank to keep"
            : "Optional access token";
        modeSelect.value =
          preferences.calendarMode ||
          (preferences.defaultCalendar ? "default" : "ask");
        status.textContent = "Loading calendars...";
        try {
          const response = await fetch("/api/user/calendar/catalog", {
              cache: "no-store",
            }),
            data = await response.json();
          if (!response.ok)
            throw new Error(data.error || "Could not load calendars.");
          select.replaceChildren(new Option("Choose a default calendar", ""));
          for (const calendar of data.calendars.filter((item) => item.writable))
            select.add(
              new Option(
                `${calendar.name} (${calendar.accountEmail})`,
                JSON.stringify({
                  connectionId: calendar.connectionId,
                  calendarId: calendar.calendarId,
                }),
              ),
            );
          if (preferences.defaultCalendar) {
            const value = JSON.stringify(preferences.defaultCalendar);
            if (![...select.options].some((option) => option.value === value))
              select.add(
                new Option(
                  "Selected calendar unavailable - reconnect it",
                  value,
                ),
              );
            select.value = value;
          }
          status.textContent =
            data.warnings?.join(" ") ||
            "Only calendars with editing permission are listed.";
        } catch (error) {
          status.textContent = error.message;
        }
      });
    document
      .getElementById("todo-save-calendar")
      .addEventListener("click", async (event) => {
        event.target.disabled = true;
        try {
          if (modeSelect.value === "default" && !select.value)
            throw new Error("Choose a default calendar first.");
          await savePreferences({
            calendarMode: modeSelect.value,
            defaultCalendar: select.value ? JSON.parse(select.value) : null,
          });
          status.textContent = "Default calendar saved.";
        } catch (error) {
          status.textContent = error.message;
        } finally {
          event.target.disabled = false;
        }
      });
    const previous = JSON.parse(
      localStorage.getItem("still.alerts.v1") || "{}",
    );
    if (
      previous.topic &&
      !localStorage.getItem("open-inbox-zero.todo.ntfy-migrated")
    ) {
      savePreferences({
        ntfyTopic: previous.topic,
        ntfyToken: sessionStorage.getItem("still.ntfy.token") || "",
      })
        .then(() => {
          localStorage.setItem("open-inbox-zero.todo.ntfy-migrated", "true");
          sessionStorage.removeItem("still.ntfy.token");
        })
        .catch(() => undefined);
    }
  }
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      initializeSettings();
      checkCalendars(bootstrap.tasks);
      setInterval(
        () => checkCalendars(JSON.parse(localStorage.getItem(taskKey) || "[]")),
        30_000,
      );
    },
    { once: true },
  );
  document.addEventListener("keydown", (event) => {
    if (
      event.key !== "Tab" ||
      event.defaultPrevented ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.target.closest(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"]),dialog',
      )
    )
      return;
    event.preventDefault();
    parent.postMessage(
      { channel: "inbox-todo", type: "navigate", shiftKey: event.shiftKey },
      location.origin,
    );
  });
  window.addEventListener("online", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flush();
  });
})();

/* Section sizes are device preferences; task saves never rebuild this layout. */
(() => {
  function initialize() {
    const list = document.getElementById("task-list");
    if (!list) return;
    const storageKey = "open-inbox-zero.todo.sections.v1";
    const defaults = {
      overdue: 0.22,
      urgent: 0.22,
      important: 1,
      unimportant: 1,
      completed: 0.18,
    };
    const labels = {
      overdue: "Overdue",
      urgent: "Urgent",
      important: "Important",
      unimportant: "Unimportant",
      completed: "Completed",
    };
    let weights = { ...defaults },
      drag = null;
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
      for (const key of Object.keys(defaults))
        if (Number.isFinite(stored?.[key]) && stored[key] >= 0)
          weights[key] = stored[key];
    } catch {}
    const sections = () =>
      [...list.children].filter((element) =>
        element.matches(".priority-section"),
      );
    const priority = (element) => element.dataset.priority;
    const minimum = (element) =>
      ["important", "unimportant"].includes(priority(element)) ? 88 : 44;
    function dimensions() {
      const rows = sections(),
        height = list.clientHeight;
      const sum = rows.reduce((n, row) => n + minimum(row), 0),
        scale = Math.min(1, height / Math.max(1, sum));
      return {
        rows,
        height,
        min: (row) => minimum(row) * scale,
        free: Math.max(0, height - sum * scale),
      };
    }
    function layout() {
      if (drag) return;
      const { rows, height, min, free } = dimensions();
      if (!rows.length || !height) return;
      const sum = rows.reduce((n, row) => n + weights[priority(row)], 0);
      for (const row of rows) {
        const weight = sum > 0 ? weights[priority(row)] / sum : 1 / rows.length;
        row.style.setProperty(
          "--todo-section-height",
          `${min(row) + free * weight}px`,
        );
      }
      updateAria();
    }
    function updateAria() {
      const { rows, min } = dimensions();
      rows.forEach((row, index) => {
        const divider = row.querySelector(":scope>.todo-section-divider");
        if (!divider || !index) return;
        const above = rows[index - 1],
          size = above.getBoundingClientRect().height,
          total = size + row.getBoundingClientRect().height;
        divider.setAttribute(
          "aria-valuemin",
          String(Math.round((min(above) / total) * 100)),
        );
        divider.setAttribute(
          "aria-valuemax",
          String(Math.round(((total - min(row)) / total) * 100)),
        );
        divider.setAttribute(
          "aria-valuenow",
          String(Math.round((size / total) * 100)),
        );
        divider.setAttribute(
          "aria-valuetext",
          `${labels[priority(above)]} ${Math.round(size)} pixels; ${labels[priority(row)]} ${Math.round(total - size)} pixels`,
        );
      });
    }
    function persist() {
      const { rows, min, free } = dimensions();
      if (free <= 0) return;
      for (const row of rows)
        weights[priority(row)] = Math.max(
          0,
          (row.getBoundingClientRect().height - min(row)) / free,
        );
      try {
        localStorage.setItem(storageKey, JSON.stringify(weights));
      } catch {}
    }
    function resize(above, below, startAbove, startBelow, delta) {
      const { min } = dimensions(),
        total = startAbove + startBelow;
      const next = Math.max(
        min(above),
        Math.min(total - min(below), startAbove + delta),
      );
      above.style.setProperty("--todo-section-height", `${next}px`);
      below.style.setProperty("--todo-section-height", `${total - next}px`);
      updateAria();
    }
    function finish() {
      if (!drag) return;
      drag = null;
      document.body.classList.remove("todo-section-resizing");
      persist();
    }
    function install() {
      finish();
      const rows = sections();
      rows.forEach((row, index) => {
        row.id = `todo-section-${priority(row)}`;
        if (!index || row.querySelector(":scope>.todo-section-divider")) return;
        const above = rows[index - 1],
          divider = document.createElement("div");
        divider.className = "todo-section-divider";
        divider.tabIndex = 0;
        divider.setAttribute("role", "separator");
        divider.setAttribute("aria-orientation", "horizontal");
        divider.setAttribute(
          "aria-label",
          `Resize ${labels[priority(above)]} and ${labels[priority(row)]} sections`,
        );
        divider.setAttribute("aria-controls", `${above.id} ${row.id}`);
        divider.title =
          "Drag up or down to resize sections. Arrow keys also work.";
        divider.addEventListener("pointerdown", (event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          divider.focus({ preventScroll: true });
          drag = {
            above,
            below: row,
            aboveHeight: above.getBoundingClientRect().height,
            belowHeight: row.getBoundingClientRect().height,
            y: event.clientY,
          };
          divider.setPointerCapture(event.pointerId);
          document.body.classList.add("todo-section-resizing");
        });
        divider.addEventListener("pointermove", (event) => {
          if (!drag) return;
          event.preventDefault();
          resize(
            drag.above,
            drag.below,
            drag.aboveHeight,
            drag.belowHeight,
            event.clientY - drag.y,
          );
        });
        divider.addEventListener("pointerup", finish);
        divider.addEventListener("pointercancel", finish);
        divider.addEventListener("lostpointercapture", finish);
        divider.addEventListener("keydown", (event) => {
          if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          event.stopPropagation();
          const a = above.getBoundingClientRect().height,
            b = row.getBoundingClientRect().height;
          const delta =
            event.key === "Home"
              ? -a
              : event.key === "End"
                ? b
                : (event.key === "ArrowUp" ? -1 : 1) *
                  (event.shiftKey ? 48 : 12);
          resize(above, row, a, b, delta);
          persist();
        });
        row.prepend(divider);
      });
      layout();
    }
    new MutationObserver(install).observe(list, { childList: true });
    new ResizeObserver(layout).observe(list);
    install();
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
