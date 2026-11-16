"use client";

import { useCallback, useEffect, useState } from "react";
import { useQueryState } from "nuqs";
import { TabSelect } from "@/components/TabSelect";
import { History } from "@/app/(app)/[emailAccountId]/assistant/History";
import { Process } from "@/app/(app)/[emailAccountId]/assistant/Process";
import { SettingsTab } from "@/app/(app)/[emailAccountId]/assistant/settings/SettingsTab";
import { RulesTab } from "@/app/(app)/[emailAccountId]/assistant/RulesTabNew";
import { useInfiniteMessages } from "@/hooks/useMessages";
import { LocalRulesPanel } from "./LocalRulesPanel";
import { TaskRulesPanel } from "./TaskRulesPanel";

const automationTabs = ["rules", "test", "history", "settings"] as const;
export type AutomationTab = (typeof automationTabs)[number];

const defaultTab: AutomationTab = "rules";

const tabOptions = [
  {
    id: "rules",
    label: "Rules",
  },
  {
    id: "test",
    label: "Test",
  },
  {
    id: "history",
    label: "History",
  },
  {
    id: "settings",
    label: "Settings",
  },
] satisfies { id: AutomationTab; label: string }[];

export function AutomationTabs() {
  const [domain, setDomain] = useQueryState("domain", {
    defaultValue: "mail",
    history: "push",
  });
  const [tab, setTab] = useQueryState("tab", {
    defaultValue: defaultTab,
    history: "push",
  });
  const selectedDomain =
    domain === "messages" || domain === "calendars" || domain === "tasks"
      ? domain
      : "mail";
  const selectedTab = isAutomationTab(tab) ? tab : defaultTab;
  return (
    <>
      <div
        role="group"
        className="border-b border-border"
        aria-label="Rule domains"
      >
        <TabSelect
          options={[
            { id: "mail", label: "Mail" },
            { id: "messages", label: "Messages" },
            { id: "calendars", label: "Calendars" },
            { id: "tasks", label: "Tasks" },
          ]}
          selected={selectedDomain}
          onSelect={(value: "mail" | "messages" | "calendars" | "tasks") =>
            setDomain(value === "mail" ? null : value)
          }
        />
      </div>
      {selectedDomain === "tasks" ? (
        <>
          <div className="border-b border-neutral-200 pt-2">
            <TabSelect
              options={[{ id: "rules", label: "Rules" }]}
              selected="rules"
              onSelect={() => setTab(null)}
            />
          </div>
          <div className="mt-2 mb-10">
            <TaskRulesPanel />
          </div>
        </>
      ) : selectedDomain === "mail" ? (
        <MailAutomationTabs />
      ) : (
        <>
          <AutomationTabNav
            selected={selectedTab}
            onSelect={(value) => setTab(value === defaultTab ? null : value)}
          />
          <div className="mt-2 mb-10">
            <LocalRulesPanel
              key={selectedDomain}
              domain={selectedDomain}
              tab={selectedTab}
              onTabChange={(value) =>
                setTab(value === defaultTab ? null : value)
              }
            />
          </div>
        </>
      )}
    </>
  );
}

function MailAutomationTabs() {
  const [tab, setTab] = useQueryState("tab", {
    defaultValue: defaultTab,
    history: "push",
  });
  const selectedTab = isAutomationTab(tab) ? tab : defaultTab;
  usePrefetchTestTabMessages(selectedTab);

  const onSelect = useCallback(
    (value: AutomationTab) => {
      setTab(value === defaultTab ? null : value);
    },
    [setTab],
  );

  return (
    <>
      <AutomationTabNav selected={selectedTab} onSelect={onSelect} />

      <div className="mt-2 mb-10">
        {selectedTab === "rules" && <RulesTab />}
        {selectedTab === "settings" && <SettingsTab />}
        {selectedTab === "test" && <Process />}
        {selectedTab === "history" && <History />}
      </div>
    </>
  );
}

function usePrefetchTestTabMessages(selectedTab: AutomationTab) {
  const [shouldPrefetch, setShouldPrefetch] = useState(false);
  useInfiniteMessages({ enabled: shouldPrefetch });

  useEffect(() => {
    if (shouldPrefetch || selectedTab === "test") return;

    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(() => setShouldPrefetch(true), {
        timeout: 1500,
      });
      return () => window.cancelIdleCallback(idleId);
    }

    const timeoutId = window.setTimeout(() => setShouldPrefetch(true), 500);
    return () => window.clearTimeout(timeoutId);
  }, [selectedTab, shouldPrefetch]);
}

function isAutomationTab(value: string): value is AutomationTab {
  return automationTabs.includes(value as AutomationTab);
}

function AutomationTabNav({
  selected,
  onSelect,
}: {
  selected: AutomationTab;
  onSelect: (tab: AutomationTab) => void;
}) {
  return (
    <div className="border-b border-neutral-200 pt-2">
      <TabSelect options={tabOptions} selected={selected} onSelect={onSelect} />
    </div>
  );
}
