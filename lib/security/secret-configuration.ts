import "server-only";

const INSECURE_MARKERS = [
  "replace-with",
  "change-me",
  "changeme",
  "development-password",
  "example-secret",
];

export function isSecureSecretValue(
  value: string | null | undefined,
  minimumLength = 32,
): value is string {
  const secret = value?.trim();
  if (!secret || Buffer.byteLength(secret, "utf8") < minimumLength) return false;
  const normalized = secret.toLowerCase();
  return !INSECURE_MARKERS.some((marker) => normalized.includes(marker));
}
