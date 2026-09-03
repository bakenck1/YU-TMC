import { ingestOneCFixedAssets, authorizeOneCRequest, parseOneCFixedAssets } from "@/lib/server/integrations/one-c-fixed-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = authorizeOneCRequest(request);
  if (unauthorized) return unauthorized;
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/xml" && contentType !== "text/xml") {
    return Response.json({ error: "unsupported_media_type", expected: ["application/xml", "text/xml"] }, { status: 415 });
  }
  try {
    const result = await ingestOneCFixedAssets(parseOneCFixedAssets(await request.text()));
    return Response.json({ success: result.errors.length === 0, ...result }, { status: result.errors.length ? 207 : 200 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "invalid_xml";
    const status = code === "xml_too_large" ? 413 : 400;
    return Response.json({ success: false, error: code }, { status });
  }
}
