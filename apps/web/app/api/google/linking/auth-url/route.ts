import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import { GOOGLE_LINKING_STATE_COOKIE_NAME } from "@/utils/gmail/constants";
import { createGoogleMailboxAuthorization } from "@/utils/gmail/mailbox-authorization";
import {
  getMailboxLinkingBlockedResponse,
  hasActiveAccountLinkingUser,
} from "@/utils/oauth/account-linking";
import { findReconnectTarget } from "@/utils/oauth/reconnect-target";
import { createOAuthLinkingAuditLogger } from "@/utils/oauth/linking-audit";
import { oauthStateCookieOptions } from "@/utils/oauth/state";

export type GetAuthLinkUrlResponse = { url: string };

export const GET = withAuth("google/linking/auth-url", async (request) => {
  const userId = request.auth.userId;

  const blockedResponse = getMailboxLinkingBlockedResponse(request);
  if (blockedResponse) return blockedResponse;

  const hasActiveUser = await hasActiveAccountLinkingUser({
    targetUserId: userId,
    logger: request.logger,
  });

  if (!hasActiveUser) {
    return NextResponse.json(
      { error: "Unauthorized", isKnownError: true, redirectTo: "/logout" },
      { status: 401 },
    );
  }

  const reconnectEmailAccountId =
    request.nextUrl.searchParams.get("emailAccountId");
  const reconnectTarget = reconnectEmailAccountId
    ? await findReconnectTarget({
        emailAccountId: reconnectEmailAccountId,
        userId,
        provider: "google",
      })
    : null;

  // Falling back to an unconstrained link would reconnect whichever mailbox the
  // browser is signed into, which is the outcome the target exists to prevent.
  if (reconnectEmailAccountId && !reconnectTarget) {
    return NextResponse.json(
      { error: "Account not found", isKnownError: true },
      { status: 404 },
    );
  }

  const {
    url: authUrl,
    state,
    stateNonce,
  } = createGoogleMailboxAuthorization({ userId, reconnectTarget });
  const logger = createOAuthLinkingAuditLogger({
    actorUserId: userId,
    logger: request.logger,
    provider: "google",
    stateNonce,
    targetUserId: userId,
  });

  logger.info("OAuth linking flow initiated");

  const response = NextResponse.json({ url: authUrl });

  response.cookies.set(
    GOOGLE_LINKING_STATE_COOKIE_NAME,
    state,
    oauthStateCookieOptions,
  );

  return response;
});
