import { ApplicationError } from "@/lib/domain/application-error";
import { configuredPublicOrigin } from "@/lib/security/public-origin";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function originForIncomingRequest(request: Request): string {
  const configured = configuredPublicOrigin();
  if (configured) return configured;
  const requestUrl = new URL(request.url);
  const host = request.headers.get("host")?.trim();
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim()
    .toLowerCase();
  const protocol =
    forwardedProtocol === "http" || forwardedProtocol === "https"
      ? `${forwardedProtocol}:`
      : requestUrl.protocol;

  // `next start --hostname 0.0.0.0` retains the bind address in request.url
  // when it is exposed through Docker. The Host header remains the browser's
  // actual destination, so use it for same-origin validation when available.
  if (!host) return requestUrl.origin;

  try {
    return new URL(`${protocol}//${host}`).origin;
  } catch {
    // An invalid Host must not weaken the check: fall back to Next's origin.
    return requestUrl.origin;
  }
}

export function requireSameOriginMutation(request: Request) {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;

  if (request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ApplicationError("forbidden", "cross_site_request_blocked");
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    throw new ApplicationError("forbidden", "cross_site_request_blocked");
  }

  try {
    if (new URL(origin).origin !== originForIncomingRequest(request)) {
      throw new ApplicationError("forbidden", "cross_site_request_blocked");
    }
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError("forbidden", "cross_site_request_blocked");
  }
}
