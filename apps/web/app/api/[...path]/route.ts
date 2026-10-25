import { currentUser } from "@clerk/nextjs/server";
import { canAccessWorkspace } from "../../../lib/hosted-access";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function proxy(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const hosted = process.env.JAYE_MODE === "hosted";
  const { path } = await context.params;
  const route = path.join("/");
  if (
    path.some((part) => part === "." || part === ".." || /[\\/?#]/.test(part))
  )
    return Response.json({ message: "Invalid path" }, { status: 400 });
  const headers = new Headers();
  if (hosted) {
    const verifiedUser = await currentUser();
    if (!canAccessWorkspace(verifiedUser))
      return Response.json(
        { message: "Sign in to access the workspace." },
        { status: 401 },
      );
    if (route === "demo/users") return Response.json([]);
    if (route.startsWith("demo/"))
      return Response.json(
        { message: "Local sign-in is disabled." },
        { status: 403 },
      );
    if (
      !["GET", "HEAD"].includes(request.method) &&
      request.headers.get("origin") !== process.env.JAYE_APP_ORIGIN
    )
      return Response.json(
        { message: "Cross-origin mutation blocked" },
        { status: 403 },
      );
    if (!process.env.JAYE_API_URL || !process.env.JAYE_API_SECRET)
      return Response.json(
        { message: "Workspace hosting is not configured." },
        { status: 503 },
      );
    headers.set("x-jaye-service-key", process.env.JAYE_API_SECRET);
    headers.set("x-jaye-user-id", verifiedUser!.id);
  } else {
    for (const name of ["cookie", "origin"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
  }
  const type = request.headers.get("content-type");
  if (type) headers.set("content-type", type);
  try {
    const upstream = await fetch(
      `${process.env.JAYE_API_URL || "http://127.0.0.1:3001"}/api/${path.map(encodeURIComponent).join("/")}${new URL(request.url).search}`,
      {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method)
          ? undefined
          : await request.arrayBuffer(),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
      },
    );
    const responseHeaders = new Headers({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    for (const name of [
      "content-type",
      "content-disposition",
      ...(!hosted ? ["set-cookie"] : []),
    ]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return Response.json(
      {
        message: "The workspace is temporarily unavailable. Please try again.",
      },
      { status: 502 },
    );
  }
}
export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
};
