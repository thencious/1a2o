"use client";
import { useEffect } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import type { LocalUpdateStatus } from "@/app/api/user/local-update/route";

const toastId = "zenro-background-compilation";
export function LocalBuildProgress() {
  const { data } = useSWR<LocalUpdateStatus>(
    "/api/user/local-update",
    async (url) => {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok)
        throw Object.assign(new Error("Build status unavailable"), {
          status: response.status,
        });
      return response.json();
    },
    {
      refreshInterval: (latest) =>
        latest?.enabled === false ? 0 : latest?.progress ? 1000 : 5000,
      revalidateOnFocus: true,
      onErrorRetry(error, _key, _config, revalidate, { retryCount }) {
        if (error.status === 401 || error.status === 403) return;
        // The web server briefly restarts when a compiled release is installed.
        setTimeout(() => revalidate({ retryCount }), 1500);
      },
    },
  );
  useEffect(() => {
    const progress = data?.progress;
    if (!progress) {
      toast.dismiss(toastId);
      return;
    }
    toast("Updating 1a2o", {
      id: toastId,
      position: "bottom-right",
      duration: Number.POSITIVE_INFINITY,
      dismissible: false,
      closeButton: false,
      description: (
        <div className="mt-2 w-full space-y-2">
          <div
            role="status"
            className="flex items-center justify-between gap-4 text-xs"
          >
            <span>{progress.label}</span>
            <span className="shrink-0 tabular-nums">
              Stage {progress.step} / {progress.steps}
            </span>
          </div>
          <Progress
            value={progress.percent}
            aria-label="Compilation progress"
            aria-valuenow={progress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={`${progress.label}, stage ${progress.step} of ${progress.steps}`}
            className="h-1.5"
          />
          {progress.detail && (
            <p className="text-xs text-muted-foreground">{progress.detail}</p>
          )}
        </div>
      ),
    });
  }, [data]);
  useEffect(
    () => () => {
      toast.dismiss(toastId);
    },
    [],
  );
  return null;
}
