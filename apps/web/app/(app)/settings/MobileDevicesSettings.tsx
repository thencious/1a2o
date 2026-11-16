"use client";
import { useEffect, useState } from "react";
import useSWR from "swr";
import QRCode from "qrcode";
import Image from "next/image";
import { Copy, Smartphone, Loader2, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Device = { id: string; name: string; createdAt: string };
export function MobileDevicesSettings() {
  const { data, mutate } = useSWR<{ devices: Device[]; addresses: string[] }>(
    "/api/mobile/pair",
    (url: string) => request(url),
    { refreshInterval: 5000 },
  );
  const [origin, setOrigin] = useState("");
  const [local, setLocal] = useState(false);
  const [pair, setPair] = useState<{ code: string; expiresAt: string } | null>(
    null,
  );
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(
      window.location.hostname,
    );
    setLocal(isLocal);
    setOrigin(isLocal ? "" : window.location.origin);
  }, []);
  useEffect(() => {
    if (!pair) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pair]);
  const address = origin || data?.addresses[0] || "";
  const link = pair
    ? `onea2o://pair?server=${encodeURIComponent(address)}&code=${pair.code}`
    : "";
  const expired = !!pair && new Date(pair.expiresAt).getTime() <= now;
  useEffect(() => {
    let active = true;
    setQr("");
    if (link && !expired)
      QRCode.toDataURL(link, {
        width: 232,
        margin: 2,
        color: { dark: "#171717", light: "#ffffff" },
      })
        .then((value) => {
          if (active) setQr(value);
        })
        .catch(() =>
          setError("Could not create QR code. Use the pairing code instead."),
        );
    return () => {
      active = false;
    };
  }, [link, expired]);
  const generate = async () => {
    setBusy(true);
    setError("");
    setPair(null);
    try {
      const url = new URL(address);
      if (
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        url.username ||
        url.password
      )
        throw new Error("Use only the server address, without a page path.");
      if (!["http:", "https:"].includes(url.protocol))
        throw new Error("Use an http:// or https:// server address.");
      const next = await request("/api/mobile/pair", {
        method: "POST",
        body: JSON.stringify({ enableLocalNetwork: local }),
      });
      setOrigin(url.origin);
      setPair(next);
      setNow(Date.now());
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not create pairing code.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section id="android" className="space-y-4 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <Smartphone className="size-5" />
        <h2 className="font-semibold">Android</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Use the same accounts and data on your phone or tablet. Keep this host
        running while you use Android. Agents are available on desktop.
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>
          Install the Android APK from{" "}
          <a
            className="underline"
            href="https://github.com/thencious/1a2o/releases"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub Releases
          </a>
          .
        </li>
        <li>
          Open 1a2o on Android and choose Connect to an existing installation.
        </li>
        <li>
          Create a pairing code below, then scan the QR with your phone camera
          or paste the pairing link into the app.
        </li>
      </ol>
      <label
        htmlFor="android-server-address"
        className="block space-y-1 text-sm"
      >
        <span>Server address</span>
        <Input
          id="android-server-address"
          aria-label="Android server address"
          value={address}
          onChange={(event) => {
            setOrigin(event.target.value);
            setPair(null);
          }}
          placeholder="https://your-1a2o.example.com"
        />
      </label>
      {local && (
        <p className="text-xs text-muted-foreground">
          Pairing enables private-network access on port 3012. Use the same
          trusted Wi-Fi; allow Node.js through Windows Firewall on private
          networks if asked. For other networks, use an HTTPS server or a
          private VPN. HTTP on Wi-Fi is not encrypted.
        </p>
      )}
      {!address && (
        <p className="text-sm text-muted-foreground">
          No private network address was found. Connect this computer to Wi-Fi
          or enter your HTTPS server address.
        </p>
      )}
      <Button onClick={generate} disabled={busy || !address}>
        {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
        {pair ? "Replace pairing code" : "Create pairing code"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {pair && (
        <div className="space-y-3">
          {expired ? (
            <p className="text-sm">
              This code expired. Create a new one to pair.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Single use. Expires in{" "}
                {Math.max(
                  0,
                  Math.ceil(
                    (new Date(pair.expiresAt).getTime() - now) / 60_000,
                  ),
                )}{" "}
                minutes. Anyone with this code can connect to your account; keep
                it private.
              </p>
              {qr && (
                <Image
                  width={232}
                  height={232}
                  unoptimized
                  src={qr}
                  alt="Scan to pair Android with this installation"
                  className="size-48 rounded-md"
                />
              )}
              <Button
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                <Copy className="mr-2 size-4" />
                {copied ? "Copied" : "Copy pairing link"}
              </Button>
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">
                  Enter the code manually
                </summary>
                <code className="mt-2 block break-all select-all">
                  {pair.code}
                </code>
              </details>
            </>
          )}
        </div>
      )}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Paired devices</h3>
        {data?.devices.length ? (
          data.devices.map((device) => (
            <div
              key={device.id}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span>
                {device.name}
                <span className="ml-2 text-xs text-muted-foreground">
                  {new Date(device.createdAt).toLocaleDateString()}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  try {
                    await request("/api/mobile/pair", {
                      method: "DELETE",
                      body: JSON.stringify({ id: device.id }),
                    });
                    await mutate();
                  } catch (error) {
                    setError(
                      error instanceof Error
                        ? error.message
                        : "Could not disconnect device.",
                    );
                  }
                }}
              >
                <Unplug className="mr-1 size-4" />
                Disconnect
              </Button>
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">
            No Android devices paired.
          </p>
        )}
      </div>
    </section>
  );
}
async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "The request failed. Try again.");
  return result;
}
