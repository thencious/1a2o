"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { UserRoundIcon } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  startChatGPTLoginAction,
  configureChatGPTAction,
} from "@/utils/actions/chatgpt";
import { getActionErrorMessage } from "@/utils/error";
import type { ChatGPTStatus } from "@/app/api/user/chatgpt/route";
import { chatGPTReasoningEffort } from "@/utils/actions/chatgpt.validation";
import { chatControlShortcut } from "@/utils/chatgpt/shortcuts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function ChatGPTConnection({
  accountSlot,
}: {
  accountSlot: HTMLElement | null;
}) {
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const controls = useRef<HTMLDivElement>(null);
  const pendingChange = useRef(false);
  const { data, error, mutate } = useSWR<ChatGPTStatus>(
    "/api/user/chatgpt",
    async (url) => {
      const response = await fetch(url);
      if (!response.ok)
        throw new Error("Could not read the ChatGPT connection.");
      return response.json();
    },
    {
      refreshInterval: (latest) =>
        latest?.pendingUntil ||
        (waiting && !latest?.loginError && (!latest?.connected || latest.error))
          ? 2000
          : 60_000,
      revalidateOnFocus: true,
    },
  );
  const configure = useCallback(
    async (
      mode: "chatgpt" | "openrouter" | "disconnect" | "model" | "reasoning",
      value?: string,
    ) => {
      if (pendingChange.current) return;
      pendingChange.current = true;
      setBusy(true);
      setFailure("");
      try {
        const result = await configureChatGPTAction({
          mode,
          model: mode === "model" ? value : undefined,
          reasoningEffort:
            mode === "reasoning"
              ? chatGPTReasoningEffort.parse(value)
              : undefined,
        });
        if (!result?.data) throw new Error(getActionErrorMessage(result ?? {}));
        if (!result.data.revocationConfirmed)
          setFailure(
            "Signed out locally. Remote revocation was not confirmed; you can also disconnect 1a2o in ChatGPT Settings.",
          );
        setWaiting(false);
        await mutate();
      } catch (error) {
        setAccountOpen(true);
        setFailure(
          error instanceof Error ? error.message : "Could not update ChatGPT.",
        );
      } finally {
        pendingChange.current = false;
        setBusy(false);
      }
    },
    [mutate],
  );
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (!data?.enabled || !data.connected) return;
      const workspace = controls.current?.closest("[data-chat-workspace]");
      if (
        !workspace?.getClientRects().length ||
        !(event.target instanceof Node) ||
        !workspace.contains(event.target)
      )
        return;
      const change = chatControlShortcut(event, data);
      if (!change) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat || busy || pendingChange.current || !change.value)
        return;
      configure(change.mode, change.value);
    };
    window.addEventListener("keydown", handle, true);
    return () => window.removeEventListener("keydown", handle, true);
  }, [data, busy, configure]);
  const login = async () => {
    // Open synchronously with the user gesture so browser popup blocking cannot hide sign-in.
    const popup = window.open(
      "about:blank",
      "zenro-chatgpt-login",
      "popup,width=560,height=780",
    );
    setBusy(true);
    setFailure("");
    try {
      const result = await startChatGPTLoginAction();
      if (!result?.data) throw new Error(getActionErrorMessage(result ?? {}));
      const url = new URL(result.data.url);
      if (url.origin !== "https://auth.openai.com")
        throw new Error("Invalid ChatGPT sign-in URL.");
      if (popup) {
        popup.opener = null;
        popup.location.href = url.href;
      } else window.location.assign(url.href);
      setWaiting(true);
      await mutate();
    } catch (error) {
      popup?.close();
      setFailure(
        error instanceof Error
          ? error.message
          : "Could not start ChatGPT sign-in.",
      );
    } finally {
      setBusy(false);
    }
  };
  const selectedModel = data?.models.find((model) => model.id === data.model);
  const problem = failure || data?.loginError || data?.error || error?.message;
  const pending = Boolean(
    data?.pendingUntil || (waiting && !data?.connected && !data?.loginError),
  );
  return (
    <>
      <div
        ref={controls}
        role="group"
        className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs"
        aria-label="Chat model controls"
      >
        {data?.enabled && data.connected && data.models.length > 0 && (
          <>
            <Select
              value={data.model ?? ""}
              disabled={busy}
              onValueChange={(value) => configure("model", value)}
            >
              <SelectTrigger
                aria-label="ChatGPT model"
                aria-keyshortcuts="Control+Shift+ArrowUp Control+Shift+ArrowDown"
                title="Model (Ctrl+Shift+↑/↓)"
                className={controlClassName}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent side="top" align="start">
                {data.models.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {Boolean(selectedModel?.reasoningLevels?.length) && (
              <Select
                value={data.reasoningEffort ?? ""}
                disabled={busy}
                onValueChange={(value) => configure("reasoning", value)}
              >
                <SelectTrigger
                  aria-label="Thinking level"
                  aria-keyshortcuts="Shift+ArrowUp Shift+ArrowDown"
                  title="Thinking level (Shift+↑/↓)"
                  className={controlClassName}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent side="top" align="start">
                  {selectedModel?.reasoningLevels?.map((level) => (
                    <SelectItem
                      key={level.effort}
                      value={level.effort}
                      title={level.description}
                    >
                      {thinkingLabel(level.effort)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </>
        )}
      </div>
      {accountSlot &&
        createPortal(
          <Popover open={accountOpen} onOpenChange={setAccountOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghostMuted"
                size="icon"
                className="relative size-8 rounded-full"
                aria-label="Chat account"
                title="Chat account"
              >
                <UserRoundIcon className="size-4" />
                {(problem || pending) && (
                  <span
                    role="img"
                    aria-label={
                      problem ? "Connection needs attention" : "Sign-in pending"
                    }
                    className={`absolute right-0.5 top-0.5 size-1.5 rounded-full ${problem ? "bg-rose-400" : "bg-amber-400"}`}
                  />
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              side="bottom"
              className="w-80 max-w-[calc(100vw-1rem)] space-y-3 border-border text-foreground"
            >
              <div className="space-y-1 text-sm">
                <p className="font-medium">Chat account</p>
                <p className="text-xs text-muted-foreground">
                  {data
                    ? data.enabled
                      ? "Using ChatGPT"
                      : "Using OpenRouter"
                    : "Checking connection…"}
                </p>
                {data?.connected && (
                  <p className="break-all text-xs text-muted-foreground">
                    {data.email ?? "Connected ChatGPT account"}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {data?.connected && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        configure(data.enabled ? "openrouter" : "chatgpt")
                      }
                    >
                      {data.enabled ? "Use OpenRouter" : "Use ChatGPT"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => configure("disconnect")}
                    >
                      Sign out
                    </Button>
                  </>
                )}
                {(!data?.connected || data.error) && (
                  <Button
                    type="button"
                    data-oai-siwc-button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={login}
                  >
                    Continue with ChatGPT
                  </Button>
                )}
              </div>
              {pending && (
                <div className="space-y-2">
                  <span role="status" className="text-muted-foreground">
                    ChatGPT sign-in pending. Finish the permissions screen in
                    your browser and wait for “Connected to ChatGPT”.
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => mutate()}
                  >
                    Check connection
                  </Button>
                </div>
              )}
              {problem && (
                <p role="alert" className="mt-1 text-destructive">
                  {problem}
                </p>
              )}
            </PopoverContent>
          </Popover>,
          accountSlot,
        )}
    </>
  );
}
const controlClassName =
  "h-8 w-auto min-w-0 max-w-44 justify-start gap-1 rounded-md border-transparent bg-transparent px-2 py-0 text-xs text-muted-foreground shadow-none hover:bg-muted [&>span]:flex-none [&>span]:truncate [&>svg]:size-3";
function thinkingLabel(effort: string) {
  if (effort === "xhigh") return "Extra high";
  if (effort === "none") return "No thinking";
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}
