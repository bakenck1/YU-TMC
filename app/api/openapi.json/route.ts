import { dockflowOpenApiDocument } from "@/lib/dockflow-openapi";

export const dynamic = "force-static";

export function GET() {
  return Response.json(dockflowOpenApiDocument, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
