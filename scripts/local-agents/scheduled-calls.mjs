export function panelTaskIds(panel) {
  return [...new Set([...(panel.taskIds ?? []), ...(panel.taskId ? [panel.taskId] : [])])];
}

export function nextScheduledCallDue(tasks, now = Date.now() / 1000) {
  const previous = tasks.filter(task => ['scheduled', 'paused'].includes(task.status)).at(-1);
  const due = previous?.status === 'paused' ? now + previous.remaining : previous?.due;
  return Math.max(now, Number.isFinite(due) ? due : now) + 3600;
}
