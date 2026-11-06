import { createIntegrationHandler } from "@/lib/server/http/integration-handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const get = createIntegrationHandler();
export function GET(request: Request) { return get(request, "auth/check"); }
