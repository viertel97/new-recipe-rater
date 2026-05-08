import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const sessionToken =
    request.cookies.get("authjs.session-token") ||
    request.cookies.get("__Secure-authjs.session-token");

  const isLoginPage = request.nextUrl.pathname === "/login";

  if (!sessionToken && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|add|_next/static|_next/image|favicon.ico|manifest.webmanifest|icons|sw\\.js).*)"],
};
