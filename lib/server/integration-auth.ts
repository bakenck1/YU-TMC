import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { consumeDurableRateLimit, rateLimitHeaders } from "@/lib/security/rate-limiter";
import { externalJson } from "@/lib/server/http/external-api";

export function integrationCredential(request: Request): string | null {
  const token = request.headers.get("authorization")?.match(/^Bearer (yu_read_[A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) return null;
  const digest = createHash("sha256").update(token).digest();
  let match = false;
  for (const suffix of ["", "_NEXT"]) {
    const hash = process.env[`INTEGRATION_API_READ_KEY_SHA256${suffix}`]?.trim() ?? "";
    const expiry = process.env[`INTEGRATION_API_READ_EXPIRES_AT${suffix}`]?.trim() ?? "";
    const expiresAt = Date.parse(expiry);
    const validHash = /^[a-f0-9]{64}$/.test(hash);
    const equal = timingSafeEqual(digest, validHash ? Buffer.from(hash, "hex") : Buffer.alloc(32));
    if (equal && validHash && Number.isFinite(expiresAt) && expiresAt > Date.now()) match = true;
  }
  return match ? digest.toString("hex") : null;
}

export async function integrationGuard(request: Request, streaming = false): Promise<Response | null> {
  // Credentials in URLs leak into logs; browser origins are intentionally unsupported.
  if (request.headers.has("origin")) return externalJson({ error: "SERVER_TO_SERVER_ONLY" }, 403);
  const credential = integrationCredential(request);
  if (!credential) return externalJson({ error: "UNAUTHORIZED" }, 401, { "WWW-Authenticate": "Bearer" });
  try {
    const rate = await consumeDurableRateLimit({
      namespace: `integration-${streaming ? "stream" : "read"}-v1`, key: credential,
      limit: streaming ? 6 : 120, windowMs: 60_000,
    });
    return rate.allowed ? null : externalJson({ error: "TOO_MANY_REQUESTS" }, 429, Object.fromEntries(rateLimitHeaders(rate)));
  } catch {
    // No process-local fallback: quotas apply across all instances and fail closed.
    return externalJson({ error: "DEPENDENCY_UNAVAILABLE" }, 503, { "Retry-After": "5" });
  }
}
