import type { Metadata } from "next";
import Link from "next/link";
import { BasicLayout } from "@/components/layouts/BasicLayout";
import { ErrorPage } from "@/components/ErrorPage";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Update 1a2o Desktop",
};

export default function DesktopUpdateRequiredPage() {
  return (
    <BasicLayout>
      <ErrorPage
        title="Update the desktop app to sign in"
        description="This version of 1a2o Desktop can no longer complete sign-in. Download the latest version, reopen the app, and try signing in again."
        button={
          <Button asChild>
            <Link href="/download">Download the latest desktop app</Link>
          </Button>
        }
      />
    </BasicLayout>
  );
}
