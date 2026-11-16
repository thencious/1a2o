import type { ComponentType } from "react";
import { RetainedWorkspaceRoute } from "@/components/WorkspaceRetention";
export function retainWorkspacePage<Props extends object>(
  Page: ComponentType<Props>,
) {
  return function RetainedWorkspacePage(props: Props) {
    return (
      <RetainedWorkspaceRoute>
        <Page {...props} />
      </RetainedWorkspaceRoute>
    );
  };
}
