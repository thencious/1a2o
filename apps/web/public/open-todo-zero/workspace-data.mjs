export function noteTitle(markdown) {
  return (
    markdown
      .split(/\r?\n/, 1)[0]
      .replace(/^#{1,6}\s*/, "")
      .trim()
      .slice(0, 250) || "Untitled note"
  );
}
export function noteDocument(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").replace(/^\n+/, "").split("\n");
  let first = (lines.shift() || "").replace(/^#{1,6}\s*/, "").trim();
  if (!first) {
    while (lines.length && !lines[0].trim()) lines.shift();
    first = (lines.shift() || "").replace(/^#{1,6}\s*/, "").trim();
  }
  return first || lines.some((line) => line.trim())
    ? `# ${first}\n${lines.join("\n")}`
    : "";
}
export function mergeWorkspaceItems(base, local, remote) {
  const baseline = new Map(base.map((item) => [item.id, item]));
  const own = new Map(local.map((item) => [item.id, item]));
  const incoming = new Map(remote.map((item) => [item.id, item]));
  const output = new Map();
  const equal = (a, b) => stable(a) === stable(b);
  for (const id of new Set([
    ...remote.map((item) => item.id),
    ...local.map((item) => item.id),
  ])) {
    const original = baseline.get(id),
      mine = own.get(id),
      theirs = incoming.get(id);
    const mineChanged = !equal(mine, original),
      theirsChanged = !equal(theirs, original);
    if (!mineChanged) {
      if (theirs) output.set(id, theirs);
      continue;
    }
    if (!theirsChanged || equal(mine, theirs)) {
      if (mine) output.set(id, mine);
      continue;
    }
    // Deletion wins for the original identity; edited content survives as a recovery copy.
    if (!mine || !theirs) {
      const edited = mine || theirs;
      if (edited) {
        const copy = recoveryCopy(edited);
        output.set(copy.id, copy);
      }
      continue;
    }
    const mineNewest =
      (mine.updatedAt ?? mine.createdAt ?? 0) >
        (theirs.updatedAt ?? theirs.createdAt ?? 0) ||
      ((mine.updatedAt ?? mine.createdAt ?? 0) ===
        (theirs.updatedAt ?? theirs.createdAt ?? 0) &&
        stable(mine) > stable(theirs));
    const newer = mineNewest ? mine : theirs,
      older = mineNewest ? theirs : mine;
    const merged = { ...newer };
    let conflict = false;
    for (const field of new Set([
      ...Object.keys(mine),
      ...Object.keys(theirs),
    ])) {
      const mineField = !equal(mine[field], original?.[field]),
        theirsField = !equal(theirs[field], original?.[field]);
      if (mineField && !theirsField) merged[field] = mine[field];
      else if (theirsField && !mineField) merged[field] = theirs[field];
      else if (
        mineField &&
        theirsField &&
        !equal(mine[field], theirs[field]) &&
        !["updatedAt", "order", "aiState", "aiError"].includes(field)
      )
        conflict = true;
    }
    output.set(id, merged);
    if (conflict) {
      const copy = recoveryCopy(older);
      output.set(copy.id, copy);
    }
  }
  return [...output.values()];
}
function recoveryCopy(item) {
  const hash = fingerprint(stable(item));
  return {
    ...item,
    id: `${item.id.slice(0, 180)}-recovered-${hash}`,
    title: `${item.title || "Untitled"} (recovered edit)`.slice(0, 250),
    recoveredFrom: item.id,
  };
}
function fingerprint(value) {
  let first = 2_166_136_261,
    second = 5381;
  for (let i = 0; i < value.length; i++) {
    first = Math.imul(first ^ value.charCodeAt(i), 16_777_619);
    second = Math.imul(second, 33) ^ value.charCodeAt(i);
  }
  return (
    (first >>> 0).toString(16).padStart(8, "0") +
    (second >>> 0).toString(16).padStart(8, "0")
  );
}
function stable(value) {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
    .join(",")}}`;
}
export function taskFromNote(note, analysis, now = Date.now()) {
  const title = analysis.evidence?.arguments?.task_title?.trim();
  if (!title)
    throw new Error(
      "AI did not return a task summary. Your note is unchanged.",
    );
  const args = analysis.evidence.arguments;
  let deadline = analysis.deadline;
  if (!deadline && args.calendar_kind !== "none" && args.calendar_start_local) {
    const at = new Date(args.calendar_start_local).getTime();
    if (Number.isFinite(at))
      deadline = {
        at,
        kind: "calendar",
        local: args.calendar_start_local,
        expression: args.calendar_start_local,
        key: `calendar:${args.calendar_start_local}`,
        anchor: now,
        source: "openrouter",
      };
  }
  return {
    id: `note-task-${note.id}`,
    sourceNoteId: note.id,
    title: title.slice(0, 250),
    confirmedTitle: title.slice(0, 250),
    confirmedAt: now,
    notes: note.notes,
    createdAt: now,
    completedAt: null,
    priority: "important",
    order: -now,
    deadline: deadline || null,
    estimatedSeconds: analysis.estimatedSeconds,
    aiState: "success",
    aiEvidence: analysis.evidence,
    aiInput: note.notes,
  };
}
