import { NextRequest, NextResponse } from "next/server";
export function proxy(_request: NextRequest) {
  // The API-host-only refresh cookie cannot be inspected on the frontend host.
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/login",
    "/register",
    "/verify-phone",
    "/verify-email",
  ],
};
