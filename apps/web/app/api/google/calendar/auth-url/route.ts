import { NextResponse } from "next/server";
import { withEmailAccount } from "@/utils/middleware";
import { getCalendarOAuth2Client } from "@/utils/calendar/client";
import { CALENDAR_STATE_COOKIE_NAME } from "@/utils/calendar/constants";
import { CALENDAR_SCOPES } from "@/utils/gmail/scopes";
import { z } from "zod";
import {
  generateSignedOAuthState,
  oauthStateCookieOptions,
} from "@/utils/oauth/state";

export type GetCalendarAuthUrlResponse = { url: string };

const getAuthUrl = ({
  emailAccountId,
  editing,
  loginHint,
}: {
  emailAccountId: string;
  editing: boolean;
  loginHint?: string;
}) => {
  const oauth2Client = getCalendarOAuth2Client();

  const state = generateSignedOAuthState({
    emailAccountId,
    type: "calendar",
    requireWrite: editing,
  });

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: CALENDAR_SCOPES,
    state,
    prompt: "consent",
    include_granted_scopes: true,
    ...(loginHint ? { login_hint: loginHint } : {}),
  });

  return { url, state };
};

export const GET = withEmailAccount(
  "google/calendar/auth-url",
  async (request) => {
    const { emailAccountId } = request.auth;
    const hint = z
      .email()
      .safeParse(request.nextUrl.searchParams.get("loginHint"));
    const { url, state } = getAuthUrl({
      emailAccountId,
      editing: request.nextUrl.searchParams.get("editing") === "true",
      loginHint: hint.success ? hint.data : undefined,
    });

    const res: GetCalendarAuthUrlResponse = { url };
    const response = NextResponse.json(res);

    response.cookies.set(
      CALENDAR_STATE_COOKIE_NAME,
      state,
      oauthStateCookieOptions,
    );

    return response;
  },
);
