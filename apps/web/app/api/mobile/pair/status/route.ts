import { NextResponse } from "next/server";
export function GET() {
  return NextResponse.json(
    { app: "1a2o", protocol: 1, pairing: true, agents: false },
    { headers: { "Cache-Control": "no-store" } },
  );
}
