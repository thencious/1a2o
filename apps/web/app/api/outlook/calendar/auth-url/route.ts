import { NextResponse } from "next/server";
import { withEmailAccount } from "@/utils/middleware";
import { getCalendarOAuth2Url } from "@/utils/outlook/calendar-client";
import { CALENDAR_STATE_COOKIE_NAME } from "@/utils/calendar/constants";
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
  const state = generateSignedOAuthState({
    emailAccountId,
    type: "calendar",
    requireWrite: editing,
  });

  const url = getCalendarOAuth2Url(state, { editing, loginHint });

  return { url, state };
};

export const GET = withEmailAccount(async (request) => {
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
});
