import { NextResponse, type NextRequest } from "next/server"

export async function proxy(request: NextRequest) {
  return NextResponse.next({ request })
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
