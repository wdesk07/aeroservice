import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const token = request.headers.get("cookie")?.split(";").some((part) => part.trim().startsWith("aero_presence_kiosk_token=")) ?? false;
  const device = request.headers.get("cookie")?.split(";").some((part) => part.trim().startsWith("aero_presence_kiosk_device_id=")) ?? false;
  return NextResponse.json({ activated: token && device }, { headers: { "Cache-Control": "no-store" } });
}
