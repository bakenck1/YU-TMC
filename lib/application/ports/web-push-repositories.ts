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
}
