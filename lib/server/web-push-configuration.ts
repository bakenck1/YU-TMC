import type { WebPushConfiguration } from "@/lib/application/services/web-push-service";

export function readWebPushConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): WebPushConfiguration | null {
  const publicKey = environment.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = environment.WEB_PUSH_VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = environment.WEB_PUSH_VAPID_SUBJECT?.trim() ?? "";
  if (!publicKey && !privateKey && !subject) return null;
  if (
    !isBase64UrlKey(publicKey, 65) ||
    !isBase64UrlKey(privateKey, 32) ||
    !isVapidSubject(subject)
  ) {
    return null;
  }
  return { publicKey, privateKey, subject };
}

function isBase64UrlKey(value: string, expectedBytes: number) {
  return (
    /^[A-Za-z0-9_-]+$/.test(value) &&
    Buffer.from(value, "base64url").byteLength === expectedBytes
  );
}

function isVapidSubject(subject: string) {
  if (subject.startsWith("mailto:")) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject.slice(7));
  }
  try {
    return new URL(subject).protocol === "https:";
  } catch {
    return false;
  }
}
