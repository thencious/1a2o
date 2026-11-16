import { retainWorkspacePage } from "@/components/retain-workspace-page";
import { TodoWorkspace } from "../todo/TodoWorkspace";
export const maxDuration = 300;
function NotesPage() {
  return <TodoWorkspace workspace="notes" />;
}
export default retainWorkspacePage(NotesPage);
