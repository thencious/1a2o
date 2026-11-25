export function noteTimestamp(note, field) {
  return field === "edited" && Number.isFinite(note.updatedAt)
    ? note.updatedAt
    : note.createdAt;
}

export function compactNoteTimestamp(timestamp, now = Date.now()) {
  const recent = now - timestamp <= 86_400_000;
  return new Intl.DateTimeFormat(
    undefined,
    recent
      ? { hour: "numeric", minute: "2-digit" }
      : {
          month: "short",
          day: "numeric",
          ...(new Date(timestamp).getFullYear() === new Date(now).getFullYear()
            ? {}
            : { year: "numeric" }),
        },
  ).format(new Date(timestamp));
}

export function manualNotes(notes) {
  const ranked = notes.some((note) => Number.isFinite(note.noteOrder));
  return notes
    .map((note, index) => ({
      note,
      rank: Number.isFinite(note.noteOrder)
        ? note.noteOrder
        : ranked
          ? -Number.MAX_SAFE_INTEGER + index
          : index,
    }))
    .sort((a, b) => a.rank - b.rank)
    .map((item) => item.note);
}

export function visibleNotes(
  notes,
  {
    query = "",
    sort = "manual",
    dateField = "created",
    from = "",
    to = "",
  } = {},
) {
  const start = from ? new Date(from).getTime() : Number.NaN;
  const end = to ? new Date(to).getTime() + 59_999 : Number.NaN;
  const search = query.trim().toLocaleLowerCase();
  const items = manualNotes(notes).filter((note) => {
    if (note.recoveredFrom) return false;
    const timestamp = noteTimestamp(note, dateField);
    return (
      `${note.title} ${note.notes}`.toLocaleLowerCase().includes(search) &&
      (!Number.isFinite(start) || timestamp >= start) &&
      (!Number.isFinite(end) || timestamp <= end)
    );
  });
  if (sort !== "manual") {
    const [field, direction] = sort.split("-");
    items.sort(
      (a, b) =>
        (noteTimestamp(a, field) - noteTimestamp(b, field)) *
        (direction === "asc" ? 1 : -1),
    );
  }
  return items;
}

export function moveNote(notes, id, targetId, after = false) {
  const ordered = manualNotes(notes);
  const source = ordered.findIndex((note) => note.id === id);
  if (
    id === targetId ||
    source < 0 ||
    !ordered.some((note) => note.id === targetId)
  )
    return notes;
  const [item] = ordered.splice(source, 1);
  const target = ordered.findIndex((note) => note.id === targetId);
  ordered.splice(target + (after ? 1 : 0), 0, item);
  return ordered.map((note, noteOrder) => ({ ...note, noteOrder }));
}
