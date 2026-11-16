"use client";
import { retainWorkspacePage } from "@/components/retain-workspace-page";

import { PageWrapper } from "@/components/PageWrapper";
import { Channels } from "./Channels";

function ChannelsPage() {
  return (
    <PageWrapper>
      <Channels />
    </PageWrapper>
  );
}

export default retainWorkspacePage(ChannelsPage);
