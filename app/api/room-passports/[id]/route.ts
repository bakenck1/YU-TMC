import { passportHandlers } from "@/lib/server/http/room-passport-runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return passportHandlers().find(request, (await context.params).id); }
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return passportHandlers().mutate(request, (await context.params).id); }
