import { noteTitle, noteDocument, taskFromNote } from "./workspace-data.mjs";
import {
  compactNoteTimestamp,
  manualNotes,
  moveNote,
  noteTimestamp,
  visibleNotes,
} from "./notes-list.mjs?v=4";

const $ = (id) => document.getElementById(id);
const host = window.InboxTodoHost;
let notes = host.initial(),
  selected = manualNotes(notes)[0]?.id ?? null,
  loading = false,
  pendingTask = null;
const converting = new Set();
let noticeTimer;
const viewKey = "zenro.notes.list-view.v1";
const view = {
  sort: "manual",
  dateField: "created",
  from: "",
  to: "",
  expanded: false,
};
try {
  const saved = JSON.parse(localStorage.getItem(viewKey) || "{}");
  for (const key of Object.keys(view))
    if (typeof saved[key] === typeof view[key]) view[key] = saved[key];
} catch {}
if (
  ![
    "manual",
    "created-desc",
    "created-asc",
    "edited-desc",
    "edited-asc",
  ].includes(view.sort)
)
  view.sort = "manual";
if (!["created", "edited"].includes(view.dateField)) view.dateField = "created";
let dragging = null;
const editedDateIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 3 5 5M4 20l4-1L21 6a2.1 2.1 0 0 0-3-3L5 16z"/></svg>';
$("sort-notes").value = view.sort;
$("notes-date-field").value = view.dateField;
$("notes-date-from").value = view.from;
$("notes-date-to").value = view.to;
view.from = $("notes-date-from").value;
view.to = $("notes-date-to").value;
function saveView() {
  try {
    localStorage.setItem(viewKey, JSON.stringify(view));
  } catch {}
  render();
}
function clearDrop() {
  document
    .querySelectorAll(".note-row.drop-before,.note-row.drop-after")
    .forEach((row) => row.classList.remove("drop-before", "drop-after"));
}
function reorder(id, targetId, after) {
  notes = moveNote(notes, id, targetId, after);
  save();
  render();
}
const editor = new toastui.Editor({
  el: $("editor-mount"),
  height: "100%",
  minHeight: "200px",
  initialValue: "",
  initialEditType: "wysiwyg",
  previewStyle: "tab",
  hideModeSwitch: true,
  autofocus: false,
  theme: "dark",
  usageStatistics: false,
  placeholder: "",
  toolbarItems: [
    ["heading", "bold", "italic"],
    ["ul", "ol", "task"],
    ["link", "code", "quote"],
  ],
  linkAttributes: { target: "_blank", rel: "noopener noreferrer" },
  customHTMLSanitizer: (html) => DOMPurify.sanitize(html),
});
$("editor-mount")
  .querySelector(".toastui-editor-defaultUI-toolbar")
  .append($("note-editor-actions"));
$("editor-mount").addEventListener(
  "keydown",
  (event) => {
    if (
      event.isComposing ||
      event.altKey ||
      event.shiftKey ||
      !event.ctrlKey ||
      event.key.toLowerCase() !== "y" ||
      !event.target.closest('[contenteditable="true"]')
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    editor.exec("redo");
  },
  true,
);
$("editor-mount")
  .querySelectorAll('[contenteditable="true"]')
  .forEach((element) => {
    element.setAttribute("aria-label", "Note text");
    element.setAttribute("role", "textbox");
    element.setAttribute("aria-multiline", "true");
  });
function current() {
  return notes.find((note) => note.id === selected);
}
function notice(text) {
  clearTimeout(noticeTimer);
  $("notes-notice").textContent = text;
  $("notes-notice").hidden = false;
  noticeTimer = setTimeout(() => ($("notes-notice").hidden = true), 8000);
}
function save() {
  try {
    host.save(notes);
    $("storage-status").textContent = "Saving…";
  } catch (error) {
    $("storage-status").textContent = error.message;
  }
}
function count() {
  const words = (current()?.notes.match(/\S+/g) || []).length;
  $("word-count").textContent = `${words} words`;
}
function render() {
  const manual = view.sort === "manual",
    filtered = !!(view.from || view.to);
  $("notes-date-filter").hidden = !view.expanded;
  $("toggle-date-filter").setAttribute("aria-expanded", String(view.expanded));
  $("toggle-date-filter").textContent = filtered
    ? "Date filter · On"
    : "Date filter";
  const items = visibleNotes(notes, {
    ...view,
    query: $("search-notes").value,
  });
  $("note-list").replaceChildren();
  for (const note of items) {
    const button = document.createElement("button");
    button.className = `note-row${selected === note.id ? " selected" : ""}`;
    button.dataset.noteId = note.id;
    button.setAttribute("aria-pressed", String(selected === note.id));
    button.draggable = manual;
    const title = document.createElement("strong");
    title.textContent = note.title;
    const preview = document.createElement("small");
    preview.textContent =
      note.notes
        .split("\n")
        .slice(1)
        .join(" ")
        .replace(/[#*_`]/g, "")
        .trim() || "Write a note…";
    const dates = document.createElement("span");
    dates.className = "note-dates";
    const created = compactNoteTimestamp(noteTimestamp(note, "created")),
      edited = compactNoteTimestamp(noteTimestamp(note, "edited"));
    const shared = created === edited,
      hasEdit =
        Number.isFinite(note.updatedAt) && note.updatedAt !== note.createdAt;
    const fields = shared
      ? [["created", hasEdit ? "Created and edited" : "Created"]]
      : [
          ["created", "Created"],
          ["edited", "Edited"],
        ];
    for (const [field, label] of fields) {
      const time = document.createElement("time"),
        instant = new Date(noteTimestamp(note, field));
      time.dateTime = instant.toISOString();
      if (field === "edited") {
        const icon = document.createElement("span");
        icon.className = "note-date-icon";
        icon.innerHTML = editedDateIcon;
        time.append(icon);
      }
      time.append(
        document.createTextNode(field === "created" ? created : edited),
      );
      time.title =
        shared && hasEdit
          ? `Created ${instant.toLocaleString()} · Edited ${new Date(note.updatedAt).toLocaleString()}`
          : `${label} ${instant.toLocaleString()}`;
      time.setAttribute("aria-label", time.title);
      dates.append(time);
    }
    const heading = document.createElement("span");
    heading.className = "note-heading";
    heading.append(title, dates);
    button.append(heading, preview);
    button.onclick = () => open(note.id);
    button.ondragstart = (event) => {
      if (!manual) return;
      dragging = note.id;
      event.dataTransfer.setData("application/x-zenro-note", note.id);
      event.dataTransfer.effectAllowed = "move";
      button.classList.add("dragging");
    };
    button.ondragover = (event) => {
      if (!manual || !dragging || dragging === note.id) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      clearDrop();
      button.classList.add(
        event.clientY >
          button.getBoundingClientRect().top + button.offsetHeight / 2
          ? "drop-after"
          : "drop-before",
      );
    };
    button.ondragleave = (event) => {
      if (!button.contains(event.relatedTarget))
        button.classList.remove("drop-before", "drop-after");
    };
    button.ondrop = (event) => {
      event.preventDefault();
      if (!manual || !dragging) return;
      const after =
        event.clientY >
        button.getBoundingClientRect().top + button.offsetHeight / 2;
      reorder(dragging, note.id, after);
      dragging = null;
    };
    button.ondragend = () => {
      dragging = null;
      clearDrop();
      button.classList.remove("dragging");
    };
    button.onkeydown = (event) => {
      if (
        !manual ||
        !event.altKey ||
        !["ArrowUp", "ArrowDown"].includes(event.key)
      )
        return;
      event.preventDefault();
      const index = items.indexOf(note),
        target = items[index + (event.key === "ArrowUp" ? -1 : 1)];
      if (target) {
        reorder(note.id, target.id, event.key === "ArrowDown");
        [...$("note-list").children]
          .find((row) => row.dataset.noteId === note.id)
          ?.focus();
      }
    };
    $("note-list").append(button);
  }
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "notes-list-empty";
    empty.textContent = notes.length
      ? "No notes match these filters."
      : "Create a note to start writing.";
    $("note-list").append(empty);
  }
}
function open(id) {
  selected = id;
  const note = current();
  $("detail-empty").hidden = !!note;
  $("detail-content").hidden = !note;
  render();
  if (!note) return;
  loading = true;
  if (note.notes.trim()) editor.setMarkdown(noteDocument(note.notes), false);
  else editor.setHTML("<h1><br></h1>", false);
  loading = false;
  count();
  updateButton();
}
function _focusEditor() {
  const mode = editor.isMarkdownMode()
    ? ".toastui-editor-md-container"
    : ".toastui-editor-ww-container";
  $("editor-mount")
    .querySelector(`${mode} [contenteditable="true"]`)
    ?.focus({ preventScroll: true });
}
$("editor-mount").addEventListener(
  "pointerdown",
  (event) => {
    if (
      !current() ||
      current().notes.trim() ||
      event.target.closest(".toastui-editor-toolbar")
    )
      return;
    event.preventDefault();
    editor.focus();
    editor.moveCursorToStart();
  },
  true,
);
function updateButton() {
  const button = $("add-to-tasks"),
    busy = converting.has(selected);
  button.disabled = busy;
  button.title = busy ? "Reading note..." : "Add to tasks";
  button.setAttribute("aria-label", button.title);
  button.setAttribute("aria-busy", String(busy));
}
editor.on("change", () => {
  if (loading || !current()) return;
  const note = current();
  note.notes = noteDocument(editor.getMarkdown());
  note.title = noteTitle(note.notes);
  note.updatedAt = Date.now();
  save();
  render();
  count();
});
$("new-note").onclick = () => {
  notes = manualNotes(notes).map((note, noteOrder) => ({ ...note, noteOrder }));
  const note = {
    id: crypto.randomUUID(),
    title: "Untitled note",
    notes: "",
    createdAt: Date.now(),
    completedAt: null,
    noteOrder: -1,
  };
  notes.unshift(note);
  save();
  open(note.id);
};
$("search-notes").oninput = render;
$("sort-notes").onchange = (event) => {
  view.sort = event.target.value;
  saveView();
};
$("toggle-date-filter").onclick = () => {
  view.expanded = !view.expanded;
  saveView();
};
$("notes-date-field").onchange = (event) => {
  view.dateField = event.target.value;
  saveView();
};
for (const [id, key] of [
  ["notes-date-from", "from"],
  ["notes-date-to", "to"],
])
  $(id).onchange = (event) => {
    view[key] = event.target.value;
    saveView();
  };
$("clear-date-filter").onclick = () => {
  view.from = "";
  view.to = "";
  $("notes-date-from").value = "";
  $("notes-date-to").value = "";
  saveView();
};
$("source-toggle").onclick = () => {
  const source = !editor.isMarkdownMode();
  editor.changeMode(source ? "markdown" : "wysiwyg", true);
  $("source-toggle").setAttribute("aria-pressed", String(source));
  $("source-toggle").title = source ? "Formatted editor" : "Markdown";
  $("source-toggle").setAttribute("aria-label", $("source-toggle").title);
};
$("delete-note").onclick = () => {
  const note = current();
  if (!note) return;
  notes = notes.filter((item) => item.id !== note.id);
  save();
  open(notes[0]?.id ?? null);
  notice("Note deleted.");
  const undo = document.createElement("button");
  undo.textContent = " Undo";
  undo.onclick = () => {
    notes.unshift(note);
    save();
    open(note.id);
    $("notes-notice").hidden = true;
  };
  $("notes-notice").append(undo);
};
async function addTask(note, task) {
  const result = await host.addTask(note, task);
  const source = notes.find((item) => item.id === note.id);
  if (source) {
    source.linkedTaskId = task.id;
    save();
  }
  if (pendingTask?.note.id === note.id) {
    pendingTask = null;
    $("time-prompt").hidden = true;
  }
  notice(
    result.existing ? "This note is already in Tasks." : "Added to Tasks.",
  );
  host
    .calendar(task.id)
    .catch((error) => notice(`Task added. Calendar: ${error.message}`));
}
$("add-to-tasks").onclick = async () => {
  const note = current();
  if (!note) return;
  if (!note.notes.trim()) {
    notice("Write a note first.");
    return;
  }
  if (note.linkedTaskId) {
    notice("This note is already in Tasks.");
    return;
  }
  if (pendingTask?.note.id === note.id) {
    $("time-prompt").hidden = false;
    return;
  }
  const snapshot = structuredClone(note);
  converting.add(note.id);
  updateButton();
  try {
    const analysis = await StillOpenRouter.detect(snapshot.notes, Date.now(), {
      summarize: true,
    });
    const task = taskFromNote(snapshot, analysis);
    if (task.deadline) {
      await addTask(snapshot, task);
    } else {
      pendingTask = { note: snapshot, task };
      $("pending-task-title").textContent = task.title;
      $("task-date").value = "";
      $("task-time").value = "";
      $("time-error").textContent = "";
      $("time-prompt").hidden = false;
      $("notes-notice").hidden = true;
    }
  } catch (error) {
    notice(error.message);
  } finally {
    converting.delete(note.id);
    updateButton();
  }
};
$("dismiss-time").onclick = () => {
  pendingTask = null;
  $("time-prompt").hidden = true;
};
$("confirm-task-time").onclick = async () => {
  if (!pendingTask) return;
  const pending = pendingTask,
    date = $("task-date").value,
    time = $("task-time").value;
  const local = `${date}T${time || "00:00"}:00`,
    instant = new Date(local);
  if (!date || !Number.isFinite(instant.getTime())) {
    $("time-error").textContent = "Choose a valid date.";
    return;
  }
  const task = structuredClone(pending.task),
    end = new Date(instant.getTime() + (time ? 15 * 60_000 : 0));
  if (!time) end.setDate(instant.getDate() + 1);
  const localString = (date) => StillDeadlines.localString(date);
  task.deadline = {
    at: instant.getTime(),
    kind: "calendar",
    local,
    expression: local,
    key: `calendar:${local}`,
    anchor: Date.now(),
    source: "manual",
  };
  task.aiEvidence.manualTime = true;
  Object.assign(task.aiEvidence.arguments, {
    calendar_kind: "deadline",
    calendar_explicit_time: !!time,
    calendar_title: task.title,
    calendar_start_local: local,
    calendar_end_local: localString(end),
  });
  $("confirm-task-time").disabled = true;
  try {
    await addTask(pending.note, task);
  } catch (error) {
    $("time-error").textContent = error.message;
  } finally {
    $("confirm-task-time").disabled = false;
  }
};
window.addEventListener("zenro-notes-merge", (event) => {
  const previous = current();
  notes = event.detail;
  render();
  const next = current();
  if (!next) open(notes[0]?.id ?? null);
  else if (previous?.notes !== next.notes) open(next.id);
});
document.addEventListener("keydown", (event) => {
  if (
    event.key !== "Tab" ||
    event.defaultPrevented ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    event.target.closest("input,textarea,select,[contenteditable]")
  )
    return;
  event.preventDefault();
  parent.postMessage(
    { channel: "inbox-todo", type: "navigate", shiftKey: event.shiftKey },
    location.origin,
  );
});
open(selected);
