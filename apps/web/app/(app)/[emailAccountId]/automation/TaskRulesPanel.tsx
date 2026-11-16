"use client";
import { useState } from "react";
import useSWR from "swr";
import {
  PlusIcon,
  MoreHorizontalIcon,
  PenIcon,
  CopyIcon,
  Trash2Icon,
  ArrowUpIcon,
  ArrowDownIcon,
  ZapIcon,
  MessageSquareIcon,
} from "lucide-react";
import {
  RulesTable,
  RulesTableRow,
  RulesToolbar,
} from "@/app/(app)/[emailAccountId]/assistant/RulesTable";
import { RuleSectionCard } from "@/app/(app)/[emailAccountId]/assistant/RuleSectionCard";
import { RuleStep } from "@/app/(app)/[emailAccountId]/assistant/RuleStep";
import { Card } from "@/components/ui/card";
import { TableCell } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/Badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { LoadingContent } from "@/components/LoadingContent";
import { saveTaskRulesAction } from "@/utils/actions/todo";
import { getActionErrorMessage } from "@/utils/error";
import { taskActionNames, type TaskRule } from "@/utils/todo/task-rules";

async function read(
  url: string,
): Promise<{ rules: TaskRule[]; revision: string }> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load task rules.");
  return response.json();
}
export function TaskRulesPanel() {
  const { data, error, mutate } = useSWR("/api/user/todo/rules", read);
  const [draft, setDraft] = useState<TaskRule | null>(null),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState("");
  async function save(rules: TaskRule[]) {
    if (!data) return;
    setBusy(true);
    setFailure("");
    try {
      const result = await saveTaskRulesAction({
        revision: data.revision,
        rules,
      });
      if (!result?.data) throw new Error(getActionErrorMessage(result ?? {}));
      await mutate();
      setDraft(null);
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : "Could not save rules.",
      );
    } finally {
      setBusy(false);
    }
  }
  function move(index: number, delta: number) {
    if (!data) return;
    const rules = [...data.rules];
    [rules[index], rules[index + delta]] = [rules[index + delta], rules[index]];
    save(rules);
  }
  const numeric =
    draft && ["tomorrow", "urgent", "remind"].includes(draft.action);
  const valueLabel =
    draft?.action === "tomorrow"
      ? "Cutoff hour (0–23)"
      : draft?.action === "urgent"
        ? "Hours before deadline, plus work estimate"
        : "Lead time in minutes (0 uses work estimate)";
  return (
    <LoadingContent
      loading={!data && !error}
      error={error ? { error: error.message } : undefined}
    >
      {data && (
        <>
          <RulesToolbar
            description="Your assistant applies these rules to task analysis, urgency, calendar entries and alerts."
            actions={
              <Button
                size="sm"
                Icon={PlusIcon}
                disabled={busy}
                onClick={() => {
                  setFailure("");
                  setDraft({
                    id: crypto.randomUUID(),
                    name: "",
                    condition: "",
                    action: "instruction",
                    enabled: true,
                    value: 0,
                  });
                }}
              >
                Add Rule
              </Button>
            }
          />
          {failure && !draft && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {failure}
            </p>
          )}
          <Card>
            <RulesTable>
              {data.rules.map((rule, index) => (
                <RulesTableRow
                  key={rule.id}
                  enabled={rule.enabled}
                  onClick={() => {
                    if (!busy) {
                      setFailure("");
                      setDraft({ ...rule });
                    }
                  }}
                >
                  <TableCell
                    className="p-2 text-center sm:p-4"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Switch
                      size="sm"
                      aria-label={`Enable ${rule.name}`}
                      checked={rule.enabled}
                      disabled={busy || rule.id === "duplicates"}
                      onCheckedChange={(enabled) =>
                        save(
                          data.rules.map((item) =>
                            item.id === rule.id ? { ...item, enabled } : item,
                          ),
                        )
                      }
                    />
                  </TableCell>
                  <TableCell className="p-2 font-medium sm:p-4">
                    {rule.name}
                  </TableCell>
                  <TableCell
                    className="hidden max-w-80 truncate p-2 text-sm sm:table-cell sm:p-4"
                    title={rule.condition}
                  >
                    {rule.condition}
                  </TableCell>
                  <TableCell className="p-2 sm:p-4">
                    <Badge color="blue">
                      {taskActionNames[rule.action]}
                      {["tomorrow", "urgent", "remind"].includes(rule.action)
                        ? ` · ${rule.value}${rule.action === "remind" ? " min" : " h"}`
                        : ""}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className="p-2 sm:p-4"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Options for ${rule.name}`}
                          disabled={busy}
                        >
                          <MoreHorizontalIcon className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => {
                            setFailure("");
                            setDraft({ ...rule });
                          }}
                        >
                          <PenIcon className="mr-2 size-4" />
                          Edit manually
                        </DropdownMenuItem>
                        {rule.action === "instruction" && (
                          <DropdownMenuItem
                            onClick={() =>
                              setDraft({
                                ...rule,
                                id: crypto.randomUUID(),
                                name: `${rule.name.slice(0, 90)} (copy)`,
                              })
                            }
                          >
                            <CopyIcon className="mr-2 size-4" />
                            Duplicate
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          disabled={index === 0}
                          onClick={() => move(index, -1)}
                        >
                          <ArrowUpIcon className="mr-2 size-4" />
                          Move up
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={index === data.rules.length - 1}
                          onClick={() => move(index, 1)}
                        >
                          <ArrowDownIcon className="mr-2 size-4" />
                          Move down
                        </DropdownMenuItem>
                        {rule.id !== "duplicates" && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => {
                                if (confirm(`Delete rule "${rule.name}"?`))
                                  save(
                                    data.rules.filter(
                                      (item) => item.id !== rule.id,
                                    ),
                                  );
                              }}
                            >
                              <Trash2Icon className="mr-2 size-4" />
                              Delete
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </RulesTableRow>
              ))}
            </RulesTable>
          </Card>
          <Dialog
            open={Boolean(draft)}
            onOpenChange={(open) => {
              if (!open && !busy) setDraft(null);
            }}
          >
            <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {data.rules.some((rule) => rule.id === draft?.id)
                    ? "Edit Rule"
                    : "Create Rule"}
                </DialogTitle>
              </DialogHeader>
              {draft && (
                <div className="space-y-5">
                  <label className="block space-y-2 text-sm font-medium">
                    Rule name
                    <input
                      aria-label="Rule name"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={draft.name}
                      maxLength={100}
                      onChange={(event) =>
                        setDraft({ ...draft, name: event.target.value })
                      }
                    />
                  </label>
                  <RuleSectionCard
                    icon={MessageSquareIcon}
                    color="blue"
                    title="When I manage a task"
                  >
                    <RuleStep
                      leftContent={null}
                      rightContent={
                        <label className="block space-y-2 text-sm">
                          {draft.action === "instruction"
                            ? "AI Prompt"
                            : "Built-in behavior"}
                          <textarea
                            aria-label={
                              draft.action === "instruction"
                                ? "AI Prompt"
                                : "Built-in behavior"
                            }
                            rows={5}
                            readOnly={draft.action !== "instruction"}
                            className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm read-only:text-muted-foreground"
                            value={draft.condition}
                            maxLength={8000}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                condition: event.target.value,
                              })
                            }
                          />
                        </label>
                      }
                    />
                  </RuleSectionCard>
                  <RuleSectionCard icon={ZapIcon} color="green" title="Then">
                    <RuleStep
                      leftContent={null}
                      rightContent={
                        <>
                          <p className="text-sm">
                            {taskActionNames[draft.action]}
                          </p>
                          {numeric && (
                            <label className="mt-3 block space-y-2 text-sm">
                              {valueLabel}
                              <input
                                aria-label={valueLabel}
                                type="number"
                                min={0}
                                max={draft.action === "tomorrow" ? 23 : 10_080}
                                step={draft.action === "tomorrow" ? 1 : "any"}
                                className="w-full rounded-md border border-input bg-background px-3 py-2"
                                value={draft.value}
                                onChange={(event) =>
                                  setDraft({
                                    ...draft,
                                    value: Number(event.target.value),
                                  })
                                }
                              />
                            </label>
                          )}
                          {draft.id === "duplicates" && (
                            <p className="mt-2 text-xs text-muted-foreground">
                              This check is required before calendar events can
                              be added.
                            </p>
                          )}
                        </>
                      }
                    />
                  </RuleSectionCard>
                  {failure && (
                    <p role="alert" className="text-sm text-destructive">
                      {failure}
                    </p>
                  )}
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => setDraft(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={
                        busy || !draft.name.trim() || !draft.condition.trim()
                      }
                      onClick={() =>
                        save(
                          data.rules.some((rule) => rule.id === draft.id)
                            ? data.rules.map((rule) =>
                                rule.id === draft.id ? draft : rule,
                              )
                            : [draft, ...data.rules],
                        )
                      }
                    >
                      {busy ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </>
      )}
    </LoadingContent>
  );
}
