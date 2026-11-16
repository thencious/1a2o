# Task time-picking instructions

## Late-night meaning of tomorrow

The user's default cutoff is **05:00 in the sender's local timezone**. The
currently configured cutoff for this request is **{{LATE_NIGHT_CUTOFF}}**; use
that configured value if it differs from the default.

Resolve `tomorrow`, `tmr`, and `tmrw` from the task's original
`task_reference_sender_time`, in `sender_timezone`:

- From 00:00 inclusive until the cutoff exclusive, these words mean **the same
  local calendar date as the task reference**. The UI may therefore correctly
  display the resulting task under **Today**.
- At the cutoff and later, these words mean **the next local calendar date**.
- An explicitly stated date takes precedence. Never apply the cutoff to an
  explicit date or to a relative duration such as `in 24 hours`.
- Use the original task reference, not the current dispatch time, a later AI
  refresh, the server's timezone, or the UTC date. Reanalyzing a task after the
  cutoff must not change which day the original `tmr` referred to.
- Resolve the target date before applying the stated clock time or the existing
  date-only deadline defaults. Do not add another day just because a requested
  clock time on the resolved date has already passed.
- Use the same resolved date for the task deadline and its calendar entry.
  Keep date-only calendar entries all-day.

Examples with the default 05:00 cutoff:

| Original local task reference | Task wording | Target local date |
| --- | --- | --- |
| Monday 00:00 | `tmr at 2pm` | Monday at 14:00 |
| Monday 01:30 | `tomorrow at 9am` | Monday at 09:00 |
| Monday 04:59 | `tmrw` | Monday, using the existing date-only defaults |
| Monday 05:00 | `tmr at 2pm` | Tuesday at 14:00 |
| Monday 23:30 | `tmr at 2pm` | Tuesday at 14:00 |

The examples illustrate the default. If the configured cutoff differs, apply
the same inclusive/exclusive rule using the configured cutoff instead.
