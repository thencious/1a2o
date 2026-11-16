import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import { linkedInContactsStatus } from "@/utils/linkedin/contacts";
import { linkedInSignInStatus } from "@/utils/linkedin/sign-in";

export const GET = withAuth("messages/contacts/linkedin", async (request) => {
  const { account, ...status } = await linkedInContactsStatus(
    request.auth.userId,
  );
  return NextResponse.json(
    { ...status, signIn: linkedInSignInStatus(request.auth.userId) },
    {
      headers: { "Cache-Control": "private, no-store" },
    },
  );
});
