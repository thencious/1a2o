const active = new Map<string, number>();
const listeners = new Set<() => void>();

export function beginDraftSync(emailAccountId: string, threadId: string) {
  const key = JSON.stringify([emailAccountId, threadId]);
  const count = active.get(key) ?? 0;
  active.set(key, count + 1);
  if (!count) for (const listener of listeners) listener();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (active.get(key) ?? 1) - 1;
    if (remaining) active.set(key, remaining);
    else {
      active.delete(key);
      for (const listener of listeners) listener();
    }
  };
}

export function isDraftSyncing(emailAccountId: string, threadId: string) {
  return active.has(JSON.stringify([emailAccountId, threadId]));
}

export function subscribeToDraftSync(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
