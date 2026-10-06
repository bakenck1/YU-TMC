import "server-only";
import type { PassportActor, RoomPassportService } from "@/lib/application/services/room-passport-service";
import { PASSPORT_ACTIONS, PASSPORT_REJECTION_REASONS, MAX_PASSPORT_BYTES, type PassportMutation } from "@/lib/contracts/room-passports";
import { ApplicationError } from "@/lib/domain/application-error";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson, readLimitedBody } from "@/lib/server/http/request-body";
import { hasPermission } from "@/lib/security/permissions";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0, must-revalidate" };
interface Dependencies {
  authenticate(request: Request): Promise<PassportActor>;
  service: Pick<RoomPassportService, "list" | "find" | "mutate" | "file">;
}
export function createPassportHandlers({ authenticate, service }: Dependencies) {
  async function run(work: () => Promise<Response>) {
    try { return await work(); } catch (error) {
      return error instanceof ApplicationError ? applicationErrorResponse(error, NO_STORE) : Response.json({ error: "passports_unavailable" }, { status: 503, headers: NO_STORE });
    }
  }
  async function manager(request: Request) {
    const actor = await authenticate(request);
    if (!hasPermission(actor.role, "inventory.passport.manage")) throw new ApplicationError("forbidden", "forbidden");
    return actor;
  }
  return {
    list: (request: Request) => run(async () => Response.json({ passports: await service.list(await manager(request)) }, { headers: NO_STORE })),
    find: (request: Request, roomId: string) => run(async () => Response.json({ passport: await service.find(roomId, await manager(request)) }, { headers: NO_STORE })),
    mutate: (request: Request, roomId: string) => run(async () => {
      const actor = await manager(request);
      const body = await readLimitedJson(request);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw invalid();
      const value = body as Record<string, unknown>;
      if (Object.keys(value).some(key => !["action", "version", "reason", "comment"].includes(key)) ||
        !PASSPORT_ACTIONS.includes(value.action as PassportMutation["action"]) || value.action === "upload" ||
        typeof value.version !== "number" || !Number.isSafeInteger(value.version) || value.version < 0 ||
        (value.reason !== undefined && !PASSPORT_REJECTION_REASONS.includes(value.reason as NonNullable<PassportMutation["reason"]>)) ||
        (value.comment !== undefined && typeof value.comment !== "string")) throw invalid();
      return Response.json({ passport: await service.mutate(roomId, value as unknown as PassportMutation, actor) }, { headers: NO_STORE });
    }),
    upload: (request: Request, roomId: string) => run(async () => {
      const actor = await manager(request);
      if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/pdf") throw new ApplicationError("unsupported_media_type", "passport_invalid_pdf");
      const rawVersion = request.headers.get("x-passport-version");
      if (rawVersion === null || !/^\d+$/.test(rawVersion)) throw invalid();
      let name: string;
      try { name = decodeURIComponent(request.headers.get("x-file-name") ?? ""); } catch { throw invalid(); }
      const bytes = await readLimitedBody(request, MAX_PASSPORT_BYTES, { timeoutMs: 30_000 });
      return Response.json({ passport: await service.mutate(roomId, { action: "upload", version: Number(rawVersion) }, actor, { bytes, name }) }, { headers: NO_STORE });
    }),
    file: (request: Request, roomId: string, published = false) => run(async () => {
      const actor = published ? await authenticate(request) : await manager(request);
      const url = new URL(request.url);
      const file = await service.file(roomId, url.searchParams.get("fileId") ?? "", actor, published);
      const encodedName = encodeURIComponent(file.name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
      return new Response(new Uint8Array(file.bytes), { headers: {
        ...NO_STORE,
        "Content-Type": "application/pdf",
        "Content-Length": String(file.bytes.byteLength),
        "Content-Disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="passport.pdf"; filename*=UTF-8''${encodedName}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'none'",
      } });
    }),
  };
}
function invalid() { return new ApplicationError("validation", "invalid_request"); }
