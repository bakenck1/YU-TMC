import { ApplicationError } from "@/lib/domain/application-error";

export function configuredPublicOrigin(
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = environment.APP_PUBLIC_ORIGIN?.trim();
  if (!value) {
    if (environment.NODE_ENV === "production") {
      throw new ApplicationError("unavailable", "public_origin_not_configured");
    }
    return null;
  }
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error("invalid origin");
    }
    return url.origin;
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError("unavailable", "public_origin_not_configured", {
      cause: error,
    });
  }
}
