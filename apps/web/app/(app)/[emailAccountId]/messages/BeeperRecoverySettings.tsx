"use client";
import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import {
  saveBeeperRecoveryAction,
  verifyBeeperRecoveryAction,
} from "@/utils/actions/beeper";
import { getActionErrorMessage } from "@/utils/error";
import type { BeeperRecoveryStatus } from "@/utils/beeper/recovery-policy";

type Preferences = {
  autoStart: boolean;
  autoVerify: boolean;
  keyStored: boolean;
  accountBound: boolean;
  status: BeeperRecoveryStatus;
};
export function BeeperRecoverySettings({
  open,
  onUpdated,
}: {
  open: boolean;
  onUpdated: () => void;
}) {
  const { data, error, mutate } = useSWR<Preferences>(
    open ? "/api/user/messages/recovery" : null,
    async (url) => {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok)
        throw new Error("Could not load Beeper recovery settings.");
      return response.json();
    },
    { revalidateOnFocus: false },
  );
  const [key, setKey] = useState("");
  const [edits, setEdits] = useState<{
    autoStart?: boolean;
    autoVerify?: boolean;
  }>({});
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState(""),
    [notice, setNotice] = useState("");
  async function save(forget = false) {
    setBusy(true);
    setFailure("");
    setNotice("");
    try {
      const result = await saveBeeperRecoveryAction(
        forget
          ? { clearKey: true }
          : { ...edits, ...(key.trim() ? { recoveryKey: key.trim() } : {}) },
      );
      if (!result || result.serverError || result.validationErrors)
        throw new Error(getActionErrorMessage(result ?? {}));
      setKey("");
      setEdits({});
      setNotice(result.data?.message || "Recovery settings saved.");
      await mutate();
      onUpdated();
    } catch (error) {
      setFailure(
        error instanceof Error
          ? error.message
          : "Could not save recovery settings.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    setBusy(true);
    setFailure("");
    try {
      const result = await verifyBeeperRecoveryAction();
      if (!result || result.serverError || result.validationErrors)
        throw new Error(getActionErrorMessage(result ?? {}));
      setNotice(result.data?.message || "Session checked.");
      await mutate();
      onUpdated();
    } catch {
      setFailure(
        "Could not check Beeper verification. Try again after reconnecting its API.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="Beeper startup and recovery"
      className="space-y-3 border-t pt-4"
    >
      <h3 className="text-sm font-medium">Startup and recovery</h3>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={edits.autoStart ?? data?.autoStart ?? true}
          disabled={busy}
          onChange={(event) =>
            setEdits((value) => ({ ...value, autoStart: event.target.checked }))
          }
        />
        Start Beeper automatically with 1a2o
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={edits.autoVerify ?? data?.autoVerify ?? true}
          disabled={busy}
          onChange={(event) =>
            setEdits((value) => ({
              ...value,
              autoVerify: event.target.checked,
            }))
          }
        />
        Use the saved recovery key when verification is needed
      </label>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label className="block space-y-1 text-sm">
          Beeper recovery key
          <input
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            value={key}
            disabled={busy}
            onChange={(event) => setKey(event.target.value)}
            placeholder={
              data?.keyStored
                ? "Key saved securely; leave blank to keep it"
                : "Paste your existing recovery key once"
            }
            className="block h-9 w-full rounded-md border bg-background px-2"
          />
        </label>
        <p className="text-xs text-muted-foreground">
          Use the recovery key Beeper gave you during setup. It is encrypted on
          this computer and used only with the matching Beeper account. It is
          never returned to this form.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={busy}>
            {busy
              ? "Saving..."
              : key.trim()
                ? "Save key and verify"
                : "Save recovery settings"}
          </Button>
          {data?.keyStored && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={verify}
            >
              Verify saved key
            </Button>
          )}
          {data?.keyStored && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => save(true)}
            >
              Forget saved key
            </Button>
          )}
        </div>
      </form>
      <p role="status" className="text-xs text-muted-foreground">
        {notice || data?.status.message || "Checking Beeper session..."}
      </p>
      {(failure || error) && (
        <p role="alert" className="text-xs text-destructive">
          {failure || error.message}
        </p>
      )}
    </section>
  );
}
