import { dockflowOpenApiDocument } from "@/lib/dockflow-openapi";
import { isDockflowDocsEnabled } from "@/lib/security/api-docs";

export const dynamic = "force-dynamic";

export function GET() {
  if (!isDockflowDocsEnabled()) {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return Response.json(dockflowOpenApiDocument, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
