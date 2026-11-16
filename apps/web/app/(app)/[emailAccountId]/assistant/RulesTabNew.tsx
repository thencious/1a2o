import { Rules } from "@/app/(app)/[emailAccountId]/assistant/Rules";
import { AddRuleDialog } from "@/app/(app)/[emailAccountId]/assistant/AddRuleDialog";
import { RulesToolbar } from "./RulesTable";
import { BulkRunRules } from "@/app/(app)/[emailAccountId]/assistant/BulkRunRules";

export function RulesTab() {
  return (
    <div>
      <RulesToolbar
        description="Your assistant automatically organizes incoming emails using these rules."
        actions={
          <>
            <BulkRunRules />
            <AddRuleDialog />
          </>
        }
      />
      <Rules showAddRuleButton={false} />
    </div>
  );
}
