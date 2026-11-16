"use client";
import useSWR from "swr";
import { Cloud, HardDrive, CheckCircle2, Clock3 } from "lucide-react";
export function CloudSyncSettings() {
  const { data, error } = useSWR<{
    enabled: boolean;
    localCopies: boolean;
    checkedAt?: number;
    workspaces: Record<
      string,
      { syncedAt?: number; pending?: boolean; error?: string }
    >;
  }>(
    "/api/user/todo/sync",
    async (url: string) => {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not check backup status");
      return response.json();
    },
    { refreshInterval: 10_000 },
  );
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <Cloud className="size-5" />
        <h2 className="font-semibold">Tasks &amp; Notes backup</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Edits save on this device first. Your host keeps an encrypted local copy
        and retries private cloud sync automatically when it reconnects.
        Conflicting edits are preserved as recovery copies.
      </p>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <HardDrive className="size-4" />
        Local copies stay on your devices.
      </p>
      {error ? (
        <p role="status" className="text-sm text-muted-foreground">
          Backup status is unavailable. Local copies remain available.
        </p>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">Checking backup...</p>
      ) : !data.enabled ? (
        <p className="text-sm text-muted-foreground">
          Cloud backup is not configured for this installation. Follow
          docs/SYNC.md to connect your private server.
        </p>
      ) : (
        <div className="space-y-2">
          {["tasks", "notes"].map((workspace) => {
            const state = data.workspaces[workspace];
            return (
              <div
                key={workspace}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span className="capitalize">{workspace}</span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {state?.pending ? (
                    <>
                      <Clock3 className="size-3.5" />
                      Saved locally; sync will retry
                    </>
                  ) : state?.syncedAt ? (
                    <>
                      <CheckCircle2 className="size-3.5" />
                      Synced {new Date(state.syncedAt).toLocaleString()}
                    </>
                  ) : (
                    "Waiting for first backup"
                  )}
                </span>
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">
            Cloud content is encrypted before upload. Download your recovery key
            and keep it somewhere private, separate from this computer. You need
            it to recover after losing this host.
          </p>
          <a
            href="/api/user/todo/sync/recovery"
            download
            className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-muted"
          >
            Download recovery key
          </a>
        </div>
      )}
    </section>
  );
}
