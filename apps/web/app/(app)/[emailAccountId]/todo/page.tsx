import { retainWorkspacePage } from "@/components/retain-workspace-page";
import { TodoWorkspace } from "./TodoWorkspace";
export const maxDuration = 300;
function TodoPage() {
  return <TodoWorkspace />;
}

export default retainWorkspacePage(TodoPage);
