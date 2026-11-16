"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PendingMessageAttachment({
  file,
  onRemove,
}: {
  file: File;
  onRemove: () => void;
}) {
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(
    null,
  );
  const isImage = file.type.startsWith("image/");
  useEffect(() => {
    if (!isImage) return;
    const url = URL.createObjectURL(file);
    setPreview({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);

  return (
    <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
      {isImage ? (
        <div
          className="group relative size-16 shrink-0 rounded-md border bg-muted"
          title={file.name}
        >
          {preview?.file === file && (
            <Image
              src={preview.url}
              alt="Pending image attachment"
              width={64}
              height={64}
              unoptimized
              className="size-full rounded-md object-cover"
            />
          )}
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label="Remove message attachment"
            onClick={onRemove}
            className="absolute -right-1 -top-1 size-5 rounded-full opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
          >
            <X className="size-3" />
          </Button>
        </div>
      ) : (
        <>
          <span className="truncate">{file.name}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="Remove message attachment"
            onClick={onRemove}
          >
            <X className="size-3" />
          </Button>
        </>
      )}
    </div>
  );
}
