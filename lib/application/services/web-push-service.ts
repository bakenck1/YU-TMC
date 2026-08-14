import type {
  WebPushRepositories,
  WebPushSubscriptionRecord,
  TmcPushOutboxEventRecord,
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

export interface MaintenanceRequestPush {
  itemId: string;
  itemName: string;
  inventoryNumber: string;
  reason: string;
  recipientIds: string[];
}

export interface TmcTransferRequestPush {
  requestId: string;
  recipientId: string;
  itemCount: number;
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
      const stored = await webPushSubscriptions.upsert({
        id: this.ids.create(),
        userId: actor.userId,
        ...subscription,
        userAgent: normalizeUserAgent(userAgent),
        now: this.clock.now(),
      });
      if (!stored) {
        throw new ApplicationError(
          "conflict",
          "push_subscription_conflict",
        );
      }
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

  async notifyMaintenanceRequest(input: MaintenanceRequestPush): Promise<void> {
    if (!this.configuration || input.recipientIds.length === 0) return;
    try {
      const subscriptions = (
        await Promise.all(
          [...new Set(input.recipientIds)].map((userId) =>
            this.unitOfWork.read(({ webPushSubscriptions }) =>
              webPushSubscriptions.listByUser(userId),
            ),
          ),
        )
      ).flat();
      await Promise.all(
        subscriptions.map(async (subscription) => {
          try {
            await this.sender.send(
              subscription,
              maintenanceRequestPayload(input, subscription.language),
              this.configuration!,
              `maintenance-${input.itemId}`.replaceAll("-", "").slice(0, 32),
            );
          } catch (error) {
            this.logger.error("maintenance_request_push_failed", {
              itemId: input.itemId,
              subscriptionId: subscription.id,
              statusCode: pushStatusCode(error),
            });
          }
        }),
      );
    } catch (error) {
      this.logger.error("maintenance_request_subscription_lookup_failed", {
        itemId: input.itemId,
        statusCode: pushStatusCode(error),
      });
    }
  }

  async notifyTmcTransferRequest(input: TmcTransferRequestPush): Promise<void> {
    if (!this.configuration) return;
    let subscriptions: WebPushSubscriptionRecord[];
    try {
      subscriptions = await this.unitOfWork.read(({ webPushSubscriptions }) =>
        webPushSubscriptions.listByUser(input.recipientId),
      );
    } catch (error) {
      this.logger.error("push_tmc_subscription_lookup_failed", {
        requestId: input.requestId,
        recipientId: input.recipientId,
        statusCode: pushStatusCode(error),
      });
      return;
    }
    const now = this.clock.now();
    const active = subscriptions.filter(
      (subscription) => !subscription.expirationTime || subscription.expirationTime > now,
    );
    const stale = subscriptions.filter(
      (subscription) => subscription.expirationTime && subscription.expirationTime <= now,
    );
    const topic = input.requestId.replaceAll("-", "").slice(0, 32);
    const outcomes = await Promise.all(active.map(async (subscription) => {
      const outcome = await this.deliverTmcWithRetry(subscription, input, topic);
      if (outcome === "stale") stale.push(subscription);
      return outcome;
    }));
    if (stale.length > 0) {
      try {
        await this.unitOfWork.transaction(async ({ webPushSubscriptions }) => {
          await Promise.all([...new Map(stale.map((subscription) => [subscription.id, subscription])).values()]
            .map((subscription) => webPushSubscriptions.deleteIfUnchanged(subscription)));
        });
      } catch (error) {
        this.logger.error("push_tmc_subscription_cleanup_failed", {
          requestId: input.requestId,
          recipientId: input.recipientId,
          statusCode: pushStatusCode(error),
        });
      }
    }
    const failed = outcomes.filter((outcome) => outcome === "failed").length;
    if (failed > 0) {
      this.logger.error("push_tmc_delivery_incomplete", {
        requestId: input.requestId,
        recipientId: input.recipientId,
        failed,
        total: active.length,
      });
    }
  }

  async processTmcPushOutbox(limit = 25): Promise<{ claimed: number; completed: number; retried: number; deadLettered: number }> {
    if (!this.configuration) return { claimed: 0, completed: 0, retried: 0, deadLettered: 0 };
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new ApplicationError("validation", "invalid_push_outbox_limit");
    }
    const workerId = this.ids.create();
    const now = this.clock.now();
    const events = await this.unitOfWork.transaction(({ tmcPushOutbox }) => {
      if (!tmcPushOutbox) throw new Error("tmc_push_outbox_repository_missing");
      return tmcPushOutbox.claim({
        workerId,
        now,
        lockedUntil: new Date(now.getTime() + 5 * 60_000),
        limit,
      });
    });
    let completed = 0;
    let retried = 0;
    let deadLettered = 0;
    for (const event of events) {
      let failed = false;
      for (const recipientId of [...new Set(event.recipientIds)]) {
        let subscriptions: WebPushSubscriptionRecord[];
        try {
          subscriptions = await this.unitOfWork.read(({ webPushSubscriptions }) =>
            webPushSubscriptions.listByUser(recipientId));
        } catch {
          failed = true;
          continue;
        }
        for (const subscription of subscriptions) {
          const deliveryNow = this.clock.now();
          const reservation = await this.unitOfWork.transaction(({ tmcPushOutbox }) => {
            if (!tmcPushOutbox) throw new Error("tmc_push_outbox_repository_missing");
            return tmcPushOutbox.reserveDelivery({
              eventId: event.eventId,
              subscriptionId: subscription.id,
              subscriptionUpdatedAt: subscription.updatedAt,
              workerId,
              now: deliveryNow,
              lockedUntil: new Date(deliveryNow.getTime() + 5 * 60_000),
            });
          });
          if (reservation === "delivered") continue;
          if (reservation === "busy") { failed = true; continue; }
          if (reservation === "cancelled") continue;
          if (subscription.expirationTime && subscription.expirationTime <= now) {
            await this.removeStaleTmcSubscription(subscription, event);
            await this.unitOfWork.transaction(({ tmcPushOutbox }) => {
              if (!tmcPushOutbox) throw new Error("tmc_push_outbox_repository_missing");
              return tmcPushOutbox.completeDelivery({ eventId: event.eventId, subscriptionId: subscription.id, workerId, completedAt: this.clock.now() });
            });
            continue;
          }
          const outcome = await this.deliverTmcEventWithRetry(subscription, event);
          if (outcome === "stale") await this.removeStaleTmcSubscription(subscription, event);
          if (outcome === "failed") {
            failed = true;
            await this.unitOfWork.transaction(({ tmcPushOutbox }) => {
              if (!tmcPushOutbox) throw new Error("tmc_push_outbox_repository_missing");
              return tmcPushOutbox.failDelivery({ eventId: event.eventId, subscriptionId: subscription.id, workerId, errorCode: "push_delivery_failed" });
            });
          } else {
            await this.unitOfWork.transaction(({ tmcPushOutbox }) => {
              if (!tmcPushOutbox) throw new Error("tmc_push_outbox_repository_missing");
              return tmcPushOutbox.completeDelivery({ eventId: event.eventId, subscriptionId: subscription.id, workerId, completedAt: this.clock.now() });
            });
          }
        }
      }
      if (!failed) {
        await this.unitOfWork.transaction(({ tmcPushOutbox }) => {
          if (!tmcPushOutbox) throw new Error("tmc_push_outbox_repository_missing");
          return tmcPushOutbox.complete({ eventId: event.eventId, workerId, completedAt: this.clock.now() });
        });
        completed += 1;
        continue;
      }
      const deadLetter = event.attempt >= 10;
      const retryAt = new Date(this.clock.now().getTime() + Math.min(3_600_000, 30_000 * 2 ** Math.min(event.attempt, 7)));
      await this.unitOfWork.transaction(({ tmcPushOutbox }) => {
        if (!tmcPushOutbox) throw new Error("tmc_push_outbox_repository_missing");
        return tmcPushOutbox.retry({
          eventId: event.eventId, workerId, availableAt: retryAt,
          errorCode: "push_delivery_incomplete", deadLetter,
        });
      });
      if (deadLetter) deadLettered += 1;
      else retried += 1;
    }
    return { claimed: events.length, completed, retried, deadLettered };
  }

  private async removeStaleTmcSubscription(subscription: WebPushSubscriptionRecord, event: TmcPushOutboxEventRecord) {
    try {
      await this.unitOfWork.transaction(({ webPushSubscriptions }) =>
        webPushSubscriptions.deleteIfUnchanged(subscription));
    } catch (error) {
      this.logger.error("push_tmc_outbox_cleanup_failed", {
        eventId: event.eventId,
        subscriptionId: subscription.id,
        statusCode: pushStatusCode(error),
      });
    }
  }

  private async deliverTmcEventWithRetry(
    subscription: WebPushSubscriptionRecord,
    event: TmcPushOutboxEventRecord,
  ): Promise<"delivered" | "stale" | "failed"> {
    const maxAttempts = Math.max(1, this.retryPolicy.maxAttempts);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.sender.send(
          subscription,
          tmcOutboxPayload(event, subscription.language),
          this.configuration!,
          event.eventId.replaceAll("-", "").slice(0, 32),
        );
        return "delivered";
      } catch (error) {
        if (isExpiredPushSubscription(error)) return "stale";
        if (!isRetryablePushFailure(error) || attempt === maxAttempts) {
          this.logger.error("push_tmc_outbox_delivery_failed", {
            eventId: event.eventId,
            requestId: event.requestId,
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

  private async deliverTmcWithRetry(
    subscription: WebPushSubscriptionRecord,
    input: TmcTransferRequestPush,
    topic: string,
  ): Promise<"delivered" | "stale" | "failed"> {
    const maxAttempts = Math.max(1, this.retryPolicy.maxAttempts);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.sender.send(
          subscription,
          tmcTransferRequestPayload(input, subscription.language),
          this.configuration!,
          topic,
        );
        return "delivered";
      } catch (error) {
        if (isExpiredPushSubscription(error)) return "stale";
        if (!isRetryablePushFailure(error) || attempt === maxAttempts) {
          this.logger.error("push_tmc_delivery_failed", {
            requestId: input.requestId,
            recipientId: input.recipientId,
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

function maintenanceRequestPayload(
  input: MaintenanceRequestPush,
  languageInput: unknown,
) {
  const language = isAppLanguage(languageInput) ? languageInput : "ru";
  return JSON.stringify({
    title: translate(language, "push.maintenanceTitle"),
    body: translate(language, "push.maintenanceTitle"),
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: `maintenance-${input.itemId}`,
    url: `/items/${encodeURIComponent(input.itemId)}`,
  });
}

function tmcTransferRequestPayload(
  input: TmcTransferRequestPush,
  languageInput: unknown,
) {
  const language = isAppLanguage(languageInput) ? languageInput : "ru";
  return JSON.stringify({
    title: translate(language, "push.tmcTransferTitle"),
    body: translate(language, "push.tmcTransferBody", { count: input.itemCount }),
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: `tmc-transfer-${input.requestId}`,
    url: `/tmc/transfer-requests/${encodeURIComponent(input.requestId)}`,
  });
}

const TMC_OUTBOX_BODY_KEYS = {
  "tmc_transfer.requested": "tmc.notifications.requested",
  "tmc_transfer.completed": "tmc.notifications.completed",
  "tmc_transfer.cancelled": "tmc.notifications.cancelled",
  "tmc_transfer.problem": "tmc.notifications.problem",
  "tmc_transfer.overdue": "tmc.notifications.overdue",
} as const;

function tmcOutboxPayload(event: TmcPushOutboxEventRecord, languageInput: unknown) {
  const language = isAppLanguage(languageInput) ? languageInput : "ru";
  const completedSummary = event.type === "tmc_transfer.completed" &&
    typeof event.safePayload.accepted === "number" &&
    typeof event.safePayload.itemCount === "number"
    ? translate(language, "tmc.request.result", {
        accepted: event.safePayload.accepted,
        total: event.safePayload.itemCount,
      })
    : null;
  return JSON.stringify({
    title: translate(language, "push.tmcTransferTitle"),
    body: completedSummary ?? translate(language, TMC_OUTBOX_BODY_KEYS[event.type]),
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: `tmc-event-${event.eventId}`,
    url: `/tmc/transfer-requests/${encodeURIComponent(event.requestId)}`,
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
      value.includes("#") ||
      (endpoint.search === "" && value.includes("?")) ||
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
