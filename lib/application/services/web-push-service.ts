import type {
  WebPushRepositories,
  WebPushSubscriptionRecord,
} from "@/lib/application/ports/web-push-repositories";
import type { UnitOfWork } from "@/lib/application/ports/unit-of-work";
import { ApplicationError } from "@/lib/domain/application-error";
import {
  hasPermission,
  type AuthorizationActor,
} from "@/lib/security/permissions";
import { isAppLanguage } from "@/lib/app-settings";
import { translate } from "@/lib/i18n";

export interface WebPushConfiguration {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface WebPushSender {
  send(
    subscription: Pick<
      WebPushSubscriptionRecord,
      "endpoint" | "p256dh" | "auth"
    >,
    payload: string,
    configuration: WebPushConfiguration,
    topic: string,
  ): Promise<void>;
}

export interface WebPushLogger {
  error(
    event: string,
    context: Record<string, string | number | undefined>,
  ): void;
}

export interface WebPushRetryPolicy {
  maxAttempts: number;
  wait(attempt: number): Promise<void>;
}

export interface WebPushSubscriptionInput {
  endpoint?: unknown;
  expirationTime?: unknown;
  keys?: unknown;
  language?: unknown;
}

export interface InspectionAssignmentPush {
  inspectionId: string;
  inspectionName: string;
  technicianId: string;
}

export class WebPushService {
  constructor(
    private readonly unitOfWork: UnitOfWork<WebPushRepositories>,
    private readonly sender: WebPushSender,
    private readonly configuration: WebPushConfiguration | null,
    private readonly clock: { now(): Date },
    private readonly ids: { create(): string },
    private readonly logger: WebPushLogger = CONSOLE_LOGGER,
    private readonly retryPolicy: WebPushRetryPolicy = DEFAULT_RETRY_POLICY,
  ) {}

  publicConfiguration() {
    return this.configuration
      ? { configured: true as const, publicKey: this.configuration.publicKey }
      : { configured: false as const, publicKey: null };
  }

  async subscribe(
    input: WebPushSubscriptionInput,
    actor: AuthorizationActor,
    userAgent: string | null,
  ): Promise<void> {
    requireNotificationPermission(actor);
    if (!this.configuration) {
      throw new ApplicationError("conflict", "push_not_configured");
    }
    const subscription = normalizeSubscription(input);
    await this.unitOfWork.transaction(async ({ webPushSubscriptions }) => {
      await webPushSubscriptions.lockUserSubscriptions(actor.userId);
      await webPushSubscriptions.upsert({
        id: this.ids.create(),
        userId: actor.userId,
        ...subscription,
        userAgent: normalizeUserAgent(userAgent),
        now: this.clock.now(),
      });
      await webPushSubscriptions.deleteOlderThanLimit(actor.userId, 10);
    });
  }

  async unsubscribe(
    endpointInput: unknown,
    actor: AuthorizationActor,
  ): Promise<void> {
    requireNotificationPermission(actor);
    const endpoint = normalizeEndpoint(endpointInput);
    await this.unitOfWork.transaction(({ webPushSubscriptions }) =>
      webPushSubscriptions.deleteForUser(actor.userId, endpoint),
    );
  }

  async notifyInspectionAssignment(
    input: InspectionAssignmentPush,
  ): Promise<void> {
    if (!this.configuration) return;
    let subscriptions: WebPushSubscriptionRecord[];
    try {
      subscriptions = await this.unitOfWork.read(
        ({ webPushSubscriptions }) =>
          webPushSubscriptions.listByUser(input.technicianId),
      );
    } catch (error) {
      this.logDeliveryFailure("push_subscription_lookup_failed", input, error);
      return;
    }
    const now = this.clock.now();
    const active = subscriptions.filter(
      (subscription) =>
        !subscription.expirationTime || subscription.expirationTime > now,
    );
    const expired = subscriptions.filter(
      (subscription) =>
        subscription.expirationTime && subscription.expirationTime <= now,
    );
    const staleSubscriptions = [...expired];

    const outcomes = await Promise.all(
      active.map(async (subscription) => {
        const outcome = await this.deliverWithRetry(
          subscription,
          inspectionAssignmentPayload(input, subscription.language),
          input,
        );
        if (outcome === "stale") {
          staleSubscriptions.push(subscription);
        }
        return outcome;
      }),
    );

    if (staleSubscriptions.length > 0) {
      try {
        await this.unitOfWork.transaction(async ({ webPushSubscriptions }) => {
          await Promise.all(
            [
              ...new Map(
                staleSubscriptions.map((subscription) => [
                  subscription.id,
                  subscription,
                ]),
              ).values(),
            ].map((subscription) =>
              webPushSubscriptions.deleteIfUnchanged(subscription),
            ),
          );
        });
      } catch (error) {
        this.logDeliveryFailure("push_subscription_cleanup_failed", input, error);
      }
    }

    const failed = outcomes.filter((outcome) => outcome === "failed").length;
    if (failed > 0) {
      this.logger.error("push_assignment_delivery_incomplete", {
        inspectionId: input.inspectionId,
        technicianId: input.technicianId,
        failed,
        total: active.length,
      });
    }
  }

  private async deliverWithRetry(
    subscription: WebPushSubscriptionRecord,
    payload: string,
    input: InspectionAssignmentPush,
  ): Promise<"delivered" | "stale" | "failed"> {
    const maxAttempts = Math.max(1, this.retryPolicy.maxAttempts);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.sender.send(
          subscription,
          payload,
          this.configuration!,
          input.inspectionId.replaceAll("-", "").slice(0, 32),
        );
        return "delivered";
      } catch (error) {
        if (isExpiredPushSubscription(error)) return "stale";
        if (!isRetryablePushFailure(error) || attempt === maxAttempts) {
          this.logger.error("push_assignment_delivery_failed", {
            inspectionId: input.inspectionId,
            technicianId: input.technicianId,
            subscriptionId: subscription.id,
            statusCode: pushStatusCode(error),
            attempts: attempt,
          });
          return "failed";
        }
        await this.retryPolicy.wait(attempt);
      }
    }
    return "failed";
  }

  private logDeliveryFailure(
    event: string,
    input: InspectionAssignmentPush,
    error: unknown,
  ) {
    this.logger.error(event, {
      inspectionId: input.inspectionId,
      technicianId: input.technicianId,
      statusCode: pushStatusCode(error),
    });
  }
}

const CONSOLE_LOGGER: WebPushLogger = {
  error(event, context) {
    console.error(event, context);
  },
};

const DEFAULT_RETRY_POLICY: WebPushRetryPolicy = {
  maxAttempts: 3,
  wait(attempt) {
    const delayMs = attempt === 1 ? 250 : 1_000;
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  },
};

function requireNotificationPermission(actor: AuthorizationActor) {
  if (!hasPermission(actor.role, "inventory.notification.read")) {
    throw new ApplicationError("forbidden", "forbidden");
  }
}

function normalizeSubscription(input: WebPushSubscriptionInput) {
  if (!input || typeof input !== "object") {
    throw new ApplicationError("validation", "invalid_push_subscription");
  }
  const keys =
    input.keys && typeof input.keys === "object"
      ? (input.keys as Record<string, unknown>)
      : null;
  const p256dh = normalizeKey(keys?.p256dh);
  const auth = normalizeKey(keys?.auth);
  let expirationTime: Date | null = null;
  if (input.expirationTime !== undefined && input.expirationTime !== null) {
    if (
      typeof input.expirationTime !== "number" ||
      !Number.isSafeInteger(input.expirationTime) ||
      input.expirationTime <= 0
    ) {
      throw new ApplicationError("validation", "invalid_push_subscription");
    }
    expirationTime = new Date(input.expirationTime);
    if (Number.isNaN(expirationTime.getTime())) {
      throw new ApplicationError("validation", "invalid_push_subscription");
    }
  }
  return {
    endpoint: normalizeEndpoint(input.endpoint),
    p256dh,
    auth,
    expirationTime,
    language: isAppLanguage(input.language) ? input.language : "ru",
  };
}

function inspectionAssignmentPayload(
  input: InspectionAssignmentPush,
  languageInput: unknown,
) {
  const language = isAppLanguage(languageInput) ? languageInput : "ru";
  return JSON.stringify({
    title: translate(language, "push.assignmentTitle"),
    body: translate(language, "push.assignmentBody", {
      name: input.inspectionName,
    }),
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: `inspection-assignment-${input.inspectionId}`,
    url: `/inventory/inspections?inspection=${encodeURIComponent(input.inspectionId)}`,
  });
}

function normalizeEndpoint(value: unknown) {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new ApplicationError("validation", "invalid_push_subscription");
  }
  try {
    const endpoint = new URL(value);
    if (
      endpoint.protocol !== "https:" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.port ||
      !isTrustedPushServiceHost(endpoint.hostname) ||
      endpoint.href !== value
    ) {
      throw new Error("invalid");
    }
    return endpoint.href;
  } catch {
    throw new ApplicationError("validation", "invalid_push_subscription");
  }
}

function isTrustedPushServiceHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "fcm.googleapis.com" ||
    normalized === "updates.push.services.mozilla.com" ||
    normalized.endsWith(".push.apple.com") ||
    normalized.endsWith(".notify.windows.com")
  );
}

function normalizeKey(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length < 16 ||
    value.length > 255 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new ApplicationError("validation", "invalid_push_subscription");
  }
  return value;
}

function normalizeUserAgent(value: string | null) {
  if (!value) return null;
  return value.normalize("NFKC").slice(0, 500);
}

function isExpiredPushSubscription(error: unknown) {
  const statusCode = pushStatusCode(error);
  return statusCode === 404 || statusCode === 410;
}

function isRetryablePushFailure(error: unknown) {
  const statusCode = pushStatusCode(error);
  return (
    statusCode === undefined ||
    statusCode === 408 ||
    statusCode === 425 ||
    statusCode === 429 ||
    statusCode >= 500
  );
}

function pushStatusCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) {
    return undefined;
  }
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === "number" ? statusCode : undefined;
}
