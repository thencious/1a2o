"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Download, Play } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function MessageMedia({
  url,
  name,
  video = false,
  withHeader = false,
}: {
  url: string;
  name: string;
  video?: boolean;
  withHeader?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!open || !video) return;
    let wasFullscreen = false;
    const fullscreenChanged = () => {
      if (
        document.fullscreenElement &&
        player.current &&
        document.fullscreenElement.contains(player.current)
      )
        wasFullscreen = true;
      else if (wasFullscreen && !document.fullscreenElement) {
        wasFullscreen = false;
        setOpen(false);
      }
    };
    document.addEventListener("fullscreenchange", fullscreenChanged);
    return () =>
      document.removeEventListener("fullscreenchange", fullscreenChanged);
  }, [open, video]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Open ${video ? "video" : "image"}: ${name}`}
          className="relative block max-w-full overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={
            withHeader
              ? {
                  borderTopLeftRadius: 0,
                  borderTopRightRadius: 0,
                  borderBottomLeftRadius: "calc(var(--radius) - 1px)",
                  borderBottomRightRadius: "calc(var(--radius) - 1px)",
                }
              : undefined
          }
        >
          {video ? (
            <>
              <video
                src={url}
                muted
                playsInline
                preload="metadata"
                className="block max-h-80 max-w-full"
                style={{
                  width: "auto",
                  height: "auto",
                  borderRadius: "inherit",
                }}
              >
                <track kind="captions" />
              </video>
              <span
                aria-hidden="true"
                className="absolute inset-0 flex items-center justify-center bg-black/10"
              >
                <Play className="size-10 rounded-full bg-black/60 p-2 text-white" />
              </span>
            </>
          ) : (
            <Image
              unoptimized
              width={640}
              height={360}
              src={url}
              alt={name}
              loading="lazy"
              className="block max-h-80 max-w-full"
              style={{ width: "auto", height: "auto", borderRadius: "inherit" }}
            />
          )}
        </button>
      </DialogTrigger>
      <DialogContent
        aria-describedby={undefined}
        className="max-w-[95vw] overflow-hidden border-0 bg-[#171717] p-10 sm:max-w-[95vw]"
        onKeyDownCapture={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          if (
            document.fullscreenElement &&
            player.current &&
            document.fullscreenElement.contains(player.current)
          )
            document.exitFullscreen().catch(() => {});
          setOpen(false);
        }}
      >
        <DialogTitle className="sr-only">{name}</DialogTitle>
        <a
          href={url}
          download={name}
          aria-label={`Download ${name}`}
          className="absolute right-12 top-4 rounded text-muted-foreground hover:text-foreground"
        >
          <Download className="size-4" />
        </a>
        {open &&
          (video ? (
            <video
              ref={player}
              src={url}
              controls
              autoPlay
              playsInline
              preload="metadata"
              className="mx-auto max-h-[80dvh] max-w-full"
            >
              <track kind="captions" />
            </video>
          ) : (
            <Image
              unoptimized
              width={1920}
              height={1080}
              src={url}
              alt={name}
              className="mx-auto max-h-[80dvh] max-w-full"
              style={{ width: "auto", height: "auto" }}
            />
          ))}
      </DialogContent>
    </Dialog>
  );
}
