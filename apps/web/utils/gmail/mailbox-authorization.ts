import { getLinkingOAuth2Client } from "@/utils/gmail/client";
import { MAILBOX_AUTH_SCOPES } from "@/utils/gmail/scopes";
import { generateSignedOAuthState } from "@/utils/oauth/state";

export function createGoogleMailboxAuthorization({
  userId,
  reconnectTarget,
  forceConsent = false,
}: {
  userId: string;
  reconnectTarget: { id: string; email: string } | null;
  forceConsent?: boolean;
}) {
  const stateNonce = crypto.randomUUID();
  const state = generateSignedOAuthState({
    userId,
    nonce: stateNonce,
    ...(reconnectTarget && { reconnectEmailAccountId: reconnectTarget.id }),
    ...(forceConsent && { forceConsent }),
  });

  const url = getLinkingOAuth2Client().generateAuthUrl({
    access_type: "offline",
    scope: [...MAILBOX_AUTH_SCOPES, "openid", "email"].join(" "),
    ...((!reconnectTarget || forceConsent) && { prompt: "consent" }),
    ...(reconnectTarget && { login_hint: reconnectTarget.email }),
    state,
  });

  return { url, state, stateNonce };
}
