import { retainWorkspacePage } from "@/components/retain-workspace-page";
import MailWorkspaceLayout from "./MailWorkspaceLayout";
import { MailShell } from "@/app/(app)/[emailAccountId]/mail/MailShell";
import { MailAccountThemeProvider } from "@/providers/MailAccountThemeProvider";
import { PermissionsCheck } from "@/app/(app)/[emailAccountId]/PermissionsCheck";
import { EmailLabelsProvider } from "@/providers/EmailLabelsProvider";
import { MailEngineHost } from "@/utils/mail-engine/MailEngineHost";

export const maxDuration = 180;

function Mail() {
  return (
    <MailWorkspaceLayout>
      <EmailLabelsProvider>
        <MailEngineHost>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <PermissionsCheck />
            <MailAccountThemeProvider>
              <MailShell />
            </MailAccountThemeProvider>
          </div>
        </MailEngineHost>
      </EmailLabelsProvider>
    </MailWorkspaceLayout>
  );
}

export default retainWorkspacePage(Mail);
