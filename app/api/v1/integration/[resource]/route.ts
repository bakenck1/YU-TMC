import { createIntegrationHandler } from "@/lib/server/http/integration-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const get = createIntegrationHandler();
type Context = { params: Promise<{ resource: string }> };
export async function GET(request: Request, context: Context) {
  return get(request, (await context.params).resource);
}
