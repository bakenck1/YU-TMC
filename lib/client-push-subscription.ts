export interface PushPublicConfiguration {
  configured: boolean;
  publicKey: string | null;
}

export function supportsWebPush() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function fetchPushConfiguration(): Promise<PushPublicConfiguration> {
  const response = await fetch("/api/push/config", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("push_config_failed");
  return response.json() as Promise<PushPublicConfiguration>;
}

export async function currentPushSubscription() {
  if (!supportsWebPush()) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

export async function enablePushNotifications(publicKey: string) {
  if (!supportsWebPush()) throw new Error("push_unsupported");
  const permission = await Notification.requestPermission();
  const permissionError = pushPermissionError(permission);
  if (permissionError) throw new Error(permissionError);
  const registration =
    (await navigator.serviceWorker.getRegistration("/")) ??
    (await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    }));
  let subscription = await registration.pushManager.getSubscription();
  if (
    subscription &&
    !subscriptionUsesApplicationServerKey(subscription, publicKey)
  ) {
    await removeStoredPushSubscription(subscription);
    subscription = null;
  }
  let created = false;
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeBase64Url(publicKey),
    });
    created = true;
  }
  try {
    await savePushSubscription(subscription);
  } catch (error) {
    if (created) await subscription.unsubscribe().catch(() => false);
    throw error;
  }
  return subscription;
}

export function pushPermissionError(permission: NotificationPermission) {
  if (permission === "denied") return "push_permission_denied";
  if (permission === "default") return "push_permission_dismissed";
  return null;
}

export async function disablePushNotifications() {
  const subscription = await currentPushSubscription();
  if (!subscription) return;
  await removeStoredPushSubscription(subscription);
}

export async function syncExistingPushSubscription(publicKey: string) {
  const subscription = await currentPushSubscription();
  if (
    subscription &&
    !subscriptionUsesApplicationServerKey(subscription, publicKey)
  ) {
    await removeStoredPushSubscription(subscription);
    return null;
  }
  if (subscription) await savePushSubscription(subscription);
  return subscription;
}

async function removeStoredPushSubscription(
  subscription: PushSubscription,
) {
  try {
    await fetch("/api/push/subscriptions", {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
  } finally {
    await subscription.unsubscribe().catch(() => false);
  }
}

export async function removePushSubscriptionBeforeLogout() {
  if (!supportsWebPush()) return;
  await disablePushNotifications().catch(() => undefined);
}

async function savePushSubscription(subscription: PushSubscription) {
  const response = await fetch("/api/push/subscriptions", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  if (!response.ok) throw new Error("push_subscription_save_failed");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replaceAll("-", "+").replaceAll("_", "/");
  const decoded = window.atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

function subscriptionUsesApplicationServerKey(
  subscription: PushSubscription,
  publicKey: string,
) {
  const actual = subscription.options.applicationServerKey;
  if (!actual) return false;
  const expected = decodeBase64Url(publicKey);
  const actualBytes = new Uint8Array(actual);
  return (
    actualBytes.length === expected.length &&
    actualBytes.every((value, index) => value === expected[index])
  );
}
