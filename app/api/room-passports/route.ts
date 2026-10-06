import { passportHandlers } from "@/lib/server/http/room-passport-runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return passportHandlers().list(request); }
