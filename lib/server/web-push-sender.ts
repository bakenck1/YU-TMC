import "server-only";

import webPush from "web-push";

import type {
  WebPushConfiguration,
  WebPushSender,
} from "@/lib/application/services/web-push-service";

export { readWebPushConfiguration } from "@/lib/server/web-push-configuration";

export class NodeWebPushSender implements WebPushSender {
  async send(
    subscription: { endpoint: string; p256dh: string; auth: string },
    payload: string,
    configuration: WebPushConfiguration,
    topic: string,
  ): Promise<void> {
    await webPush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      },
      payload,
      {
        TTL: 86_400,
        timeout: 5_000,
        topic,
        urgency: "high",
        vapidDetails: {
          subject: configuration.subject,
          publicKey: configuration.publicKey,
          privateKey: configuration.privateKey,
        },
      },
    );
  }
}
