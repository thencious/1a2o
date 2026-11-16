import Image from "next/image";
import { BRAND_LOGO_URL, BRAND_NAME } from "@/utils/branding";
export function Logo({ className }: { className?: string }) {
  return (
    <Image
      src={BRAND_LOGO_URL}
      alt={`${BRAND_NAME} logo`}
      width={32}
      height={32}
      className={className}
      unoptimized
    />
  );
}
