"use client";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  startLinkedInSignInAction,
  cancelLinkedInSignInAction,
  disconnectLinkedInContactsAction,
  syncLinkedInContactsAction,
} from "@/utils/actions/linkedin-contacts";
import { getActionErrorMessage } from "@/utils/error";

type ConnectionStatus = {
  connected: boolean;
  requiresReconnect: boolean;
  error: string | null;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  importing: boolean;
  importedSoFar: number;
  savedCount: number;
  pausedUntil: string | null;
  signIn: {
    phase:
      | "opening"
      | "waiting"
      | "saving"
      | "connected"
      | "cancelled"
      | "error";
    error: string | null;
  } | null;
};

export function LinkedInContactsConnection({
  onChange,
}: {
  onChange?: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const { data, error, mutate } = useSWR<ConnectionStatus>(
    "/api/user/messages/contacts/linkedin",
    async (url) => {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok)
        throw new Error("Could not read LinkedIn connection status.");
      return response.json();
    },
    { refreshInterval: open ? 2000 : 60_000, revalidateOnFocus: true },
  );
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const revision = useRef<string | null>(null);
  const currentRevision = data
    ? `${data.connected}:${data.requiresReconnect}:${data.lastSyncAt}:${data.importedSoFar}`
    : null;
  useEffect(() => {
    if (currentRevision === null || currentRevision === revision.current)
      return;
    const previous = revision.current;
    revision.current = currentRevision;
    if (previous !== null) onChange?.();
  }, [currentRevision, onChange]);
  const signingIn =
    data?.signIn &&
    ["opening", "waiting", "saving"].includes(data.signIn.phase);
  async function perform(action: "connect" | "sync" | "disconnect" | "cancel") {
    if (busy) return;
    setBusy(true);
    setFailure("");
    try {
      const result =
        action === "connect"
          ? await startLinkedInSignInAction()
          : action === "sync"
            ? await syncLinkedInContactsAction()
            : action === "cancel"
              ? await cancelLinkedInSignInAction()
              : await disconnectLinkedInContactsAction();
      if (!result?.data) throw new Error(getActionErrorMessage(result ?? {}));
      await mutate();
      await onChange?.();
    } catch (error) {
      setFailure(
        error instanceof Error
          ? error.message
          : "Could not update LinkedIn connection.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {/* biome-ignore lint/a11y/useValidAnchor: This compact contact-row action is intentionally a hyperlink-style dialog trigger. */}
        <a
          href="#linkedin-sync"
          className="whitespace-nowrap text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(event) => {
            event.preventDefault();
            setOpen(true);
          }}
        >
          {data?.requiresReconnect ? "Reconnect" : "Sync"}
        </a>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogTitle>LinkedIn connections</DialogTitle>
        <DialogDescription>
          Sign in to LinkedIn once. 1a2o will import your connections and update
          them automatically each day while it runs.
        </DialogDescription>
        <div className="rounded-md border p-3 text-sm" role="status">
          {connectionMessage(data, Boolean(signingIn))}
          {data?.connected && !signingIn && !data.requiresReconnect && (
            <p className="mt-2 text-xs text-muted-foreground">
              {data.importing
                ? "Your contacts are saved automatically as they arrive. You can close this window; the import continues in the background."
                : "Saved automatically. Daily updates are enabled."}
            </p>
          )}
          {data?.pausedUntil && (
            <p className="mt-2 text-xs text-muted-foreground">
              Resumes automatically at{" "}
              {new Date(data.pausedUntil).toLocaleString()}. You do not need to
              reconnect.
            </p>
          )}
          {data?.lastSyncAt && (
            <p className="mt-1 text-xs text-muted-foreground">
              Last successful sync: {new Date(data.lastSyncAt).toLocaleString()}
            </p>
          )}
          {data?.nextSyncAt && !data.importing && (
            <p className="mt-1 text-xs text-muted-foreground">
              Next sync: {new Date(data.nextSyncAt).toLocaleString()}
            </p>
          )}
          {data?.error && (
            <p className="mt-2 text-xs text-muted-foreground">{data.error}</p>
          )}
          {data?.signIn?.error && (
            <p className="mt-2 text-xs text-muted-foreground">
              {data.signIn.error}
            </p>
          )}
          {data?.signIn?.phase === "cancelled" && (
            <p className="mt-2 text-xs text-muted-foreground">
              Sign-in was closed. You can try again.
            </p>
          )}
        </div>
        {(!data?.connected || data.requiresReconnect || signingIn) && (
          <p className="text-xs text-muted-foreground">
            A separate LinkedIn window opens on this PC. Enter your password and
            any verification there. 1a2o stores the resulting session encrypted;
            it does not save your password or send your contacts to AI.
          </p>
        )}
        {(failure || error) && (
          <p role="alert" className="text-sm text-destructive">
            {failure || error.message}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {data?.connected && !data.requiresReconnect ? (
            <Button onClick={() => setOpen(false)}>Done</Button>
          ) : (
            <Button
              disabled={busy || !data || Boolean(signingIn)}
              onClick={() => perform("connect")}
            >
              {busy
                ? "Working…"
                : data?.connected
                  ? "Reconnect LinkedIn"
                  : "Connect LinkedIn"}
            </Button>
          )}
          {signingIn && (
            <Button
              variant="outline"
              disabled={busy || data?.signIn?.phase === "saving"}
              onClick={() => perform("cancel")}
            >
              Cancel sign-in
            </Button>
          )}
          {data?.connected && (
            <Button
              variant="outline"
              disabled={
                busy ||
                Boolean(signingIn) ||
                data.requiresReconnect ||
                Boolean(data.pausedUntil) ||
                data.importing
              }
              onClick={() => perform("sync")}
            >
              Sync now
            </Button>
          )}
        </div>
        {data?.connected && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Connection options</summary>
            <Button
              className="justify-start px-0 text-muted-foreground"
              variant="link"
              disabled={busy || data.signIn?.phase === "saving"}
              onClick={() => perform("disconnect")}
            >
              Disconnect and remove imported contacts
            </Button>
          </details>
        )}
      </DialogContent>
    </Dialog>
  );
}

function connectionMessage(
  data: ConnectionStatus | undefined,
  signingIn: boolean,
) {
  if (!data) return "Loading connection…";
  if (signingIn)
    return data.signIn?.phase === "saving"
      ? "Saving connection…"
      : "Complete sign-in in the LinkedIn window.";
  if (!data.connected) return "Not connected";
  if (data.requiresReconnect) return "Reconnect required";
  const count = data.savedCount ?? data.importedSoFar ?? 0;
  if (data.pausedUntil)
    return `Import paused · ${count.toLocaleString()} connections available`;
  if (data.importing)
    return count
      ? `${count.toLocaleString()} connections saved so far`
      : "Starting import…";
  return `${count.toLocaleString()} connections imported`;
}
