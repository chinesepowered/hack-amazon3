import { protectedResourceMetadata } from "@/lib/oauth";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return Response.json(protectedResourceMetadata(new URL(req.url).origin), { headers: { "access-control-allow-origin": "*" } });
}
