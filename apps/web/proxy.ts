import { clerkMiddleware } from "@clerk/nextjs/server";
import {
  NextResponse,
  type NextRequest,
  type NextFetchEvent,
} from "next/server";
const hosted = clerkMiddleware();
export default function proxy(request: NextRequest, event: NextFetchEvent) {
  return process.env.JAYE_MODE === "hosted"
    ? hosted(request, event)
    : NextResponse.next();
}
export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|pdf)).*)",
    "/api/(.*)",
  ],
};
