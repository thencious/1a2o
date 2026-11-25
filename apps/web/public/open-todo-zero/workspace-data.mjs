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
      if (theirs) output.set(id, withRecoveryHistory(theirs, [mine, theirs]));
      continue;
    }
    if (!theirsChanged || equal(mine, theirs)) {
      if (mine) output.set(id, withRecoveryHistory(mine, [mine, theirs]));
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
      if (field === "recoveredVersions") continue;
      const mineField = !equal(mine[field], original?.[field]),
        theirsField = !equal(theirs[field], original?.[field]);
      if (mineField && !theirsField) merged[field] = mine[field];
      else if (theirsField && !mineField) merged[field] = theirs[field];
      else if (
        mineField &&
        theirsField &&
        !equal(mine[field], theirs[field]) &&
        !["updatedAt", "order", "noteOrder", "aiState", "aiError"].includes(
          field,
        )
      )
        conflict = true;
    }
    output.set(
      id,
      withRecoveryHistory(merged, [mine, theirs], conflict ? [older] : []),
    );
  }
  return consolidateRecoveryCopies([...output.values()]);
}
function recoveryCopy(item) {
  const hash = versionFingerprint(item);
  return {
    ...item,
    id: `${item.id.slice(0, 180)}-recovered-${hash}`,
    title: `${item.title || "Untitled"} (recovered edit)`.slice(0, 250),
    recoveredFrom: item.id,
  };
}

export function consolidateRecoveryCopies(items) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const archived = new Map();
  const visible = [];
  for (const item of items) {
    let root = item,
      seen = new Set([item.id]);
    while (
      root.recoveredFrom &&
      byId.has(root.recoveredFrom) &&
      !seen.has(root.recoveredFrom)
    ) {
      seen.add(root.recoveredFrom);
      root = byId.get(root.recoveredFrom);
    }
    if (root.id !== item.id) {
      const versions = archived.get(root.id) || [];
      versions.push(item);
      archived.set(root.id, versions);
    } else visible.push(item);
  }
  return visible.map((item) =>
    withRecoveryHistory(item, [item], archived.get(item.id) || []),
  );
}

function withRecoveryHistory(current, sources, variants = []) {
  const versions = new Map(),
    currentHash = versionFingerprint(current);
  const queue = [
    ...sources.flatMap((source) => source?.recoveredVersions || []),
    ...variants.flatMap((source) => [
      ...(source.recoveredVersions || []),
      source,
    ]),
  ];
  for (const version of queue) {
    const hash = versionFingerprint(version);
    if (hash === currentHash) continue;
    const previous = versions.get(hash);
    if (previous && (previous.updatedAt || 0) >= (version.updatedAt || 0))
      continue;
    const { recoveredVersions, ...snapshot } = version;
    versions.set(hash, snapshot);
  }
  const result = { ...current };
  if (versions.size)
    result.recoveredVersions = [...versions.values()].sort(
      (a, b) =>
        (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0),
    );
  else delete result.recoveredVersions;
  return result;
}

function versionFingerprint(item) {
  const content = Object.fromEntries(
    Object.entries(item).filter(
      ([key]) =>
        ![
          "id",
          "createdAt",
          "updatedAt",
          "order",
          "noteOrder",
          "recoveredFrom",
          "recoveredVersions",
        ].includes(key),
    ),
  );
  if (item.recoveredFrom)
    content.title = (content.title || "").replace(
      /(?: \(recovered edit\))+$/,
      "",
    );
  return fingerprint(stable(content));
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
