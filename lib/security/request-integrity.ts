import { ApplicationError } from "@/lib/domain/application-error";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function requireSameOriginMutation(request: Request) {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;

  if (request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ApplicationError("forbidden", "cross_site_request_blocked");
  }

  const origin = request.headers.get("origin");
  if (!origin) return;

  try {
    if (new URL(origin).origin !== new URL(request.url).origin) {
      throw new ApplicationError("forbidden", "cross_site_request_blocked");
    }
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError("forbidden", "cross_site_request_blocked");
  }
}
