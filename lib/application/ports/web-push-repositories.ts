export interface WebPushSubscriptionRecord {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime: Date | null;
  userAgent: string | null;
  language: "ru" | "kk" | "en";
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertWebPushSubscriptionRecord {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime: Date | null;
  userAgent: string | null;
  language: "ru" | "kk" | "en";
  now: Date;
}

export interface WebPushSubscriptionRepository {
  lockUserSubscriptions(userId: string): Promise<void>;
  upsert(
    input: UpsertWebPushSubscriptionRecord,
  ): Promise<WebPushSubscriptionRecord>;
  listByUser(userId: string): Promise<WebPushSubscriptionRecord[]>;
  deleteOlderThanLimit(userId: string, keep: number): Promise<void>;
  deleteForUser(userId: string, endpoint: string): Promise<void>;
  deleteIfUnchanged(
    subscription: Pick<
      WebPushSubscriptionRecord,
      | "id"
      | "userId"
      | "endpoint"
      | "p256dh"
      | "auth"
      | "expirationTime"
      | "language"
      | "updatedAt"
    >,
  ): Promise<void>;
}

export interface WebPushRepositories {
  webPushSubscriptions: WebPushSubscriptionRepository;
  tmcPushOutbox?: TmcPushOutboxRepository;
}

export interface TmcPushOutboxEventRecord {
  eventId: string;
  type: "tmc_transfer.requested" | "tmc_transfer.completed" | "tmc_transfer.cancelled" | "tmc_transfer.problem" | "tmc_transfer.overdue";
  requestId: string;
  safePayload: Record<string, string | number | boolean | null>;
  recipientIds: string[];
  attempt: number;
}

export interface TmcPushOutboxRepository {
  claim(input: { workerId: string; now: Date; lockedUntil: Date; limit: number }): Promise<TmcPushOutboxEventRecord[]>;
  complete(input: { eventId: string; workerId: string; completedAt: Date }): Promise<void>;
  retry(input: { eventId: string; workerId: string; availableAt: Date; errorCode: string; deadLetter: boolean }): Promise<void>;
  reserveDelivery(input: { eventId: string; subscriptionId: string; subscriptionUpdatedAt: Date; workerId: string; now: Date; lockedUntil: Date }): Promise<"reserved" | "delivered" | "busy" | "cancelled">;
  completeDelivery(input: { eventId: string; subscriptionId: string; workerId: string; completedAt: Date }): Promise<void>;
  failDelivery(input: { eventId: string; subscriptionId: string; workerId: string; errorCode: string }): Promise<void>;
}
