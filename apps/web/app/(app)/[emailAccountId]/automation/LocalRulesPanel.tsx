"use client";

import { useState, type ChangeEvent } from "react";
import useSWR from "swr";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarDaysIcon,
  CopyIcon,
  HistoryIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PenIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AutosizeTextarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Input, Label } from "@/components/Input";
import { Combobox } from "@/components/Combobox";
import { LoadingContent } from "@/components/LoadingContent";
import { MutedText, SectionHeader } from "@/components/Typography";
import { SettingCard } from "@/components/SettingCard";
import { TruncatedTooltipText } from "@/components/TruncatedTooltipText";
import {
  RulesTable,
  RulesTableRow,
  RulesToolbar,
} from "@/app/(app)/[emailAccountId]/assistant/RulesTable";
import { ActionBadges } from "@/app/(app)/[emailAccountId]/assistant/ActionBadges";
import { RuleSectionCard } from "@/app/(app)/[emailAccountId]/assistant/RuleSectionCard";
import { RuleStep } from "@/app/(app)/[emailAccountId]/assistant/RuleStep";
import { ActionType } from "@/generated/prisma/enums";
import {
  saveLocalAutomationAction,
  testLocalAutomationAction,
} from "@/utils/actions/local-automation";
import { getActionErrorMessage } from "@/utils/error";
import type {
  LocalRule,
  RuleDomain,
  RuleHistory,
} from "@/utils/automation/local-rules";
import type { AutomationTab } from "./AutomationTabs";

type Settings = {
  revision: string;
  enabled: boolean;
  rules: LocalRule[];
  history: RuleHistory[];
  lastError?: string;
};
async function read(url: string): Promise<Settings> {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Could not load rules.");
  return data;
}

export function LocalRulesPanel({
  domain,
  tab,
  onTabChange,
}: {
  domain: RuleDomain;
  tab: AutomationTab;
  onTabChange: (tab: AutomationTab) => void;
}) {
  const { data, error, mutate } = useSWR(
    `/api/user/automation?domain=${domain}`,
    read,
    { refreshInterval: tab === "history" ? 5000 : 0 },
  );
  const [draft, setDraft] = useState<LocalRule | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [text, setText] = useState("");
  const [testResult, setTestResult] = useState<{
    label: string | null;
    ruleName?: string;
  } | null>(null);
  const [historyRule, setHistoryRule] = useState("all");
  const [labelSearch, setLabelSearch] = useState("");
  const subject = domain === "messages" ? "messages" : "calendar events";
  const provider = domain === "messages" ? "beeper" : "calendar";
  const save = async (rules: LocalRule[], enabled = data?.enabled ?? true) => {
    if (!data) return;
    setBusy(true);
    setFailure("");
    try {
      const result = await saveLocalAutomationAction({
        domain,
        revision: data.revision,
        rules,
        enabled,
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
  };
  const newRule = () => {
    if (busy) return;
    setFailure("");
    setLabelSearch("");
    setDraft({
      id: crypto.randomUUID(),
      name: "",
      condition: "",
      action: "label",
      label: "",
      enabled: true,
    });
  };
  const editRule = (rule: LocalRule) => {
    if (busy) return;
    setFailure("");
    setLabelSearch("");
    setDraft({ ...rule });
  };
  const move = (index: number, delta: number) => {
    if (!data) return;
    const rules = [...data.rules];
    [rules[index], rules[index + delta]] = [rules[index + delta], rules[index]];
    save(rules);
  };
  const labels = [
    ...new Set([
      ...(domain === "messages"
        ? ["Business", "Casual", "Notification", "Other"]
        : []),
      ...(data?.rules.map((rule) => rule.label) ?? []),
      ...(draft?.label ? [draft.label] : []),
    ]),
  ];
  return (
    <LoadingContent
      loading={!data && !error}
      error={error ? { error: error.message } : undefined}
    >
      {data && (
        <div className="space-y-6">
          {failure && !draft && (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          )}
          {data.lastError && (
            <p role="status" className="text-sm text-muted-foreground">
              {data.lastError}
            </p>
          )}
          {tab === "rules" && (
            <div>
              <RulesToolbar
                description={`Your assistant automatically organizes incoming ${subject} using these rules.`}
                actions={
                  <Button
                    size="sm"
                    Icon={PlusIcon}
                    onClick={newRule}
                    disabled={busy}
                  >
                    Add Rule
                  </Button>
                }
              />
              {!data.enabled && (
                <MutedText className="mb-2">
                  Automatic rules are paused in Settings.
                </MutedText>
              )}
              <Card>
                {data.rules.length ? (
                  <RulesTable>
                    {data.rules.map((rule, index) => (
                      <RulesTableRow
                        key={rule.id}
                        enabled={rule.enabled}
                        onClick={() => editRule(rule)}
                      >
                        <TableCell
                          onClick={(event) => event.stopPropagation()}
                          className="p-2 text-center sm:p-4"
                        >
                          <Switch
                            size="sm"
                            aria-label={`Enable ${rule.name}`}
                            checked={rule.enabled}
                            disabled={busy}
                            onCheckedChange={(enabled) =>
                              save(
                                data.rules.map((item) =>
                                  item.id === rule.id
                                    ? { ...item, enabled }
                                    : item,
                                ),
                              )
                            }
                          />
                        </TableCell>
                        <TableCell className="p-2 font-medium sm:p-4">
                          {rule.name}
                        </TableCell>
                        <TableCell className="hidden p-2 sm:table-cell sm:p-4">
                          <TruncatedTooltipText
                            text={rule.condition}
                            maxLength={50}
                            className="max-w-xs"
                          />
                        </TableCell>
                        <TableCell className="p-2 sm:p-4">
                          <ActionBadges
                            actions={[
                              {
                                id: rule.id,
                                type: ActionType.LABEL,
                                label: rule.label,
                              },
                            ]}
                            provider={provider}
                            labels={[]}
                          />
                        </TableCell>
                        <TableCell
                          className="w-fit whitespace-nowrap px-1 py-2 text-center"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label={`Options for ${rule.name}`}
                                disabled={busy}
                              >
                                <MoreHorizontalIcon className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => editRule(rule)}>
                                <PenIcon className="mr-2 size-4" />
                                Edit manually
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  editRule({
                                    ...rule,
                                    id: crypto.randomUUID(),
                                    name: `${rule.name.slice(0, 93)} (copy)`,
                                  })
                                }
                              >
                                <CopyIcon className="mr-2 size-4" />
                                Duplicate
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setHistoryRule(`rule:${rule.name}`);
                                  onTabChange("history");
                                }}
                              >
                                <HistoryIcon className="mr-2 size-4" />
                                History
                              </DropdownMenuItem>
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
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => {
                                  if (
                                    confirm(
                                      `Are you sure you want to delete the rule "${rule.name}"?`,
                                    )
                                  )
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
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </RulesTableRow>
                    ))}
                  </RulesTable>
                ) : (
                  <CardHeader>
                    <CardDescription className="flex flex-col items-center gap-4 py-20">
                      You don?t have any rules yet.
                      <Button size="sm" onClick={newRule}>
                        Add Rule
                      </Button>
                    </CardDescription>
                  </CardHeader>
                )}
              </Card>
            </div>
          )}
          {tab === "test" && (
            <div className="space-y-4">
              <CardDescription>
                Check how your rules perform against {subject}.
              </CardDescription>
              <Card>
                <CardContent className="space-y-4 p-4">
                  <Label
                    name="local-rule-test"
                    label={
                      domain === "messages"
                        ? "Conversation text"
                        : "Event details"
                    }
                  />
                  <AutosizeTextarea
                    id="local-rule-test"
                    minRows={5}
                    value={text}
                    onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                      setText(event.target.value)
                    }
                    placeholder={`Paste ${domain === "messages" ? "a conversation" : "an event"} to test your rules`}
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      Icon={PlayIcon}
                      loading={busy}
                      disabled={!text.trim()}
                      onClick={async () => {
                        setBusy(true);
                        setFailure("");
                        try {
                          const result = await testLocalAutomationAction({
                            domain,
                            text,
                          });
                          if (!result?.data)
                            throw new Error(
                              getActionErrorMessage(result ?? {}),
                            );
                          setTestResult(result.data);
                        } catch (error) {
                          setFailure(
                            error instanceof Error
                              ? error.message
                              : "Could not test rules.",
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Test rules
                    </Button>
                  </div>
                  {testResult && (
                    <div role="status" className="space-y-2">
                      <MutedText>
                        {testResult.ruleName || "No matching rule"}
                      </MutedText>
                      {testResult.label && (
                        <ActionBadges
                          actions={[
                            {
                              id: "test",
                              type: ActionType.LABEL,
                              label: testResult.label,
                            },
                          ]}
                          provider={provider}
                          labels={[]}
                        />
                      )}
                    </div>
                  )}
                  <MutedText>
                    Uses one request from your shared OpenRouter allowance. Does
                    not change a conversation or event.
                  </MutedText>
                </CardContent>
              </Card>
            </div>
          )}
          {tab === "history" && (
            <div>
              <Select value={historyRule} onValueChange={setHistoryRule}>
                <SelectTrigger
                  className="mb-2 w-[220px]"
                  aria-label="Filter history by rule"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All rules</SelectItem>
                  {[
                    ...new Set([
                      ...data.rules.map((rule) => rule.name),
                      ...data.history.map((item) => item.ruleName),
                    ]),
                  ]
                    .filter(Boolean)
                    .map((name) => (
                      <SelectItem key={name} value={`rule:${name}`}>
                        {name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        {domain === "messages" ? "Conversation" : "Event"}
                      </TableHead>
                      <TableHead>Rule</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.history
                      .filter(
                        (item) =>
                          historyRule === "all" ||
                          `rule:${item.ruleName}` === historyRule,
                      )
                      .map((item, index) => (
                        <TableRow key={`${item.id}:${item.at}:${index}`}>
                          <TableCell className="font-medium">
                            {item.title}
                          </TableCell>
                          <TableCell>{item.ruleName}</TableCell>
                          <TableCell>
                            {item.label ? (
                              <ActionBadges
                                actions={[
                                  {
                                    id: item.id,
                                    type: ActionType.LABEL,
                                    label: item.label,
                                  },
                                ]}
                                provider={provider}
                                labels={[]}
                              />
                            ) : (
                              <MutedText>No label</MutedText>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {new Date(item.at).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    {!data.history.some(
                      (item) =>
                        historyRule === "all" ||
                        `rule:${item.ruleName}` === historyRule,
                    ) && (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="py-12 text-center text-muted-foreground"
                        >
                          No history
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}
          {tab === "settings" && (
            <div className="max-w-4xl space-y-6">
              <SectionHeader>Automation</SectionHeader>
              <SettingCard
                title="Automatically apply rules"
                description={`Automatically label ${subject} across your connected accounts. Rules run from top to bottom; the first matching rule applies.`}
                right={
                  <Switch
                    aria-label="Automatically apply rules"
                    checked={data.enabled}
                    disabled={busy}
                    onCheckedChange={(enabled) => save(data.rules, enabled)}
                  />
                }
              />
            </div>
          )}
          <Dialog
            open={Boolean(draft)}
            onOpenChange={(open) => {
              if (!open && !busy) setDraft(null);
            }}
          >
            <DialogContent
              className="max-h-[90vh] max-w-3xl overflow-y-auto"
              aria-describedby={undefined}
            >
              <DialogHeader>
                <DialogTitle>
                  {data.rules.some((rule) => rule.id === draft?.id)
                    ? "Edit Rule"
                    : "Create Rule"}
                </DialogTitle>
              </DialogHeader>
              {draft && (
                <form
                  className="space-y-10"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (
                      !draft.name.trim() ||
                      !draft.condition.trim() ||
                      !draft.label.trim()
                    ) {
                      setFailure(
                        "Enter a rule name, an AI prompt, and a label.",
                      );
                      return;
                    }
                    const existing = data.rules.some(
                      (rule) => rule.id === draft.id,
                    );
                    save(
                      existing
                        ? data.rules.map((rule) =>
                            rule.id === draft.id ? draft : rule,
                          )
                        : [
                            ...data.rules.filter((rule) => rule.id !== "other"),
                            draft,
                            ...data.rules.filter((rule) => rule.id === "other"),
                          ],
                    );
                  }}
                >
                  <Input
                    type="text"
                    name="local-rule-name"
                    label="Rule name"
                    placeholder="e.g. Label business conversations"
                    registerProps={{
                      value: draft.name,
                      required: true,
                      maxLength: 100,
                      onChange: (event: ChangeEvent<HTMLInputElement>) =>
                        setDraft({ ...draft, name: event.target.value }),
                    }}
                  />
                  <RuleSectionCard
                    icon={
                      domain === "messages"
                        ? MessageSquareIcon
                        : CalendarDaysIcon
                    }
                    color="blue"
                    title={
                      domain === "messages"
                        ? "When I get a message"
                        : "When I have a calendar event"
                    }
                    className="!mt-6"
                  >
                    <RuleStep
                      leftContent={
                        <Select value="prompt">
                          <SelectTrigger
                            className="w-[120px]"
                            aria-label="Condition type"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="prompt">AI Prompt</SelectItem>
                          </SelectContent>
                        </Select>
                      }
                      rightContent={
                        <>
                          <div className="mb-2">
                            <Label
                              name="local-rule-prompt"
                              label="That matches:"
                            />
                          </div>
                          <AutosizeTextarea
                            id="local-rule-prompt"
                            minRows={3}
                            rows={3}
                            required
                            maxLength={4000}
                            value={draft.condition}
                            onChange={(
                              event: ChangeEvent<HTMLTextAreaElement>,
                            ) =>
                              setDraft({
                                ...draft,
                                condition: event.target.value,
                              })
                            }
                            placeholder={`Describe which ${domain === "messages" ? "conversations" : "events"} should match`}
                          />
                        </>
                      }
                    />
                  </RuleSectionCard>
                  <RuleSectionCard icon={ZapIcon} color="green" title="Then">
                    <RuleStep
                      leftContent={
                        <Select value="label">
                          <SelectTrigger
                            className="w-[160px]"
                            aria-label="Action type"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="label">Label as</SelectItem>
                          </SelectContent>
                        </Select>
                      }
                      rightContent={
                        <Combobox
                          options={labels.map((label) => ({
                            value: label,
                            label,
                          }))}
                          value={draft.label}
                          onChangeValue={(label) =>
                            setDraft({ ...draft, label })
                          }
                          search={labelSearch}
                          onSearch={setLabelSearch}
                          loading={false}
                          placeholder="Select a label"
                          emptyText={
                            <div>
                              No labels
                              {labelSearch.trim() && (
                                <Button
                                  className="mt-2"
                                  type="button"
                                  variant="outline"
                                  onClick={() => {
                                    setDraft({
                                      ...draft,
                                      label: labelSearch.trim().slice(0, 60),
                                    });
                                    setLabelSearch("");
                                  }}
                                >{`Create "${labelSearch.trim()}" label`}</Button>
                              )}
                            </div>
                          }
                        />
                      }
                    />
                  </RuleSectionCard>
                  {failure && (
                    <p role="alert" className="text-sm text-destructive">
                      {failure}
                    </p>
                  )}
                  <div className="!mt-6 flex justify-end space-x-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => setDraft(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      loading={busy}
                      disabled={!draft.label.trim()}
                    >
                      Save
                    </Button>
                  </div>
                </form>
              )}
            </DialogContent>
          </Dialog>
        </div>
      )}
    </LoadingContent>
  );
}
