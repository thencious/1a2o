import type { taskPolicy } from "./task-rules";

export function taskReminderTime(
  task: {
    completedAt?: number | null;
    deadline?: unknown;
    estimatedSeconds?: unknown;
  },
  policy: Pick<
    ReturnType<typeof taskPolicy>,
    "remindersEnabled" | "reminderLeadMinutes"
  >,
) {
  const due = task.deadline as { at?: number } | undefined;
  if (!policy.remindersEnabled || task.completedAt || !Number.isFinite(due?.at))
    return null;
  const lead =
    policy.reminderLeadMinutes > 0
      ? policy.reminderLeadMinutes * 60
      : Number(task.estimatedSeconds) || 0;
  return { at: due!.at! - lead * 1000, due: due!.at! };
}
