import { retainWorkspacePage } from "@/components/retain-workspace-page";
import { ContactsWorkspace } from "./ContactsWorkspace";

function ContactsPage() {
  return <ContactsWorkspace />;
}
export const maxDuration = 300;
export default retainWorkspacePage(ContactsPage);
