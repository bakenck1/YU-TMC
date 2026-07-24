import "server-only";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

interface SharedRateLimitState {
  buckets: Map<string, RateLimitBucket>;
  lastSweepAt: number;
}

interface RateLimiterOptions {
  namespace: string;
  limit: number;
  windowMs: number;
  maxKeys?: number;
}

type RateLimitGlobal = typeof globalThis & {
  __yuInventoryRateLimitStores?: Map<string, SharedRateLimitState>;
};

function getSharedState(namespace: string): SharedRateLimitState {
  const sharedGlobal = globalThis as RateLimitGlobal;
  sharedGlobal.__yuInventoryRateLimitStores ??= new Map();

  const existing = sharedGlobal.__yuInventoryRateLimitStores.get(namespace);
  if (existing) return existing;

  const state: SharedRateLimitState = {
    buckets: new Map(),
    lastSweepAt: Date.now(),
  };
  sharedGlobal.__yuInventoryRateLimitStores.set(namespace, state);
  return state;
}

export class InMemoryRateLimiter {
  private readonly namespace: string;
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly state: SharedRateLimitState;

  constructor({ namespace, limit, windowMs, maxKeys = 10_000 }: RateLimiterOptions) {
    if (!namespace.trim()) throw new Error("Rate limiter namespace is required");
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Rate limiter limit must be positive");
    if (!Number.isFinite(windowMs) || windowMs < 1) throw new Error("Rate limiter window must be positive");

    this.namespace = namespace;
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.state = getSharedState(namespace);
  }

  check(key: string, now = Date.now()): RateLimitResult {
    this.sweepIfNeeded(now);
    const bucket = this.getLiveBucket(key, now);

    if (!bucket) {
      return this.result(true, 0, now + this.windowMs, now);
    }

    return this.result(bucket.count < this.limit, bucket.count, bucket.resetAt, now);
  }

  consume(key: string, now = Date.now()): RateLimitResult {
    this.sweepIfNeeded(now);
    const existing = this.getLiveBucket(key, now);
    const bucket = existing ?? { count: 0, resetAt: now + this.windowMs };
    bucket.count += 1;
    this.state.buckets.set(key, bucket);
    this.enforceCapacity();

    return this.result(bucket.count <= this.limit, bucket.count, bucket.resetAt, now);
  }

  reset(key: string) {
    this.state.buckets.delete(key);
  }

  private result(allowed: boolean, count: number, resetAt: number, now: number): RateLimitResult {
    return {
      allowed,
      limit: this.limit,
      remaining: Math.max(0, this.limit - count),
      resetAt,
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((resetAt - now) / 1000)),
    };
  }

  private getLiveBucket(key: string, now: number) {
    const bucket = this.state.buckets.get(key);
    if (!bucket) return null;
    if (bucket.resetAt > now) return bucket;
    this.state.buckets.delete(key);
    return null;
  }

  private sweepIfNeeded(now: number) {
    if (now - this.state.lastSweepAt < this.windowMs) return;
    for (const [key, bucket] of this.state.buckets) {
      if (bucket.resetAt <= now) this.state.buckets.delete(key);
    }
    this.state.lastSweepAt = now;
  }

  private enforceCapacity() {
    if (this.state.buckets.size <= this.maxKeys) return;

    const oldest = [...this.state.buckets.entries()]
      .sort((left, right) => left[1].resetAt - right[1].resetAt)
      .slice(0, this.state.buckets.size - this.maxKeys);

    for (const [key] of oldest) this.state.buckets.delete(key);
  }
}

export function rateLimitHeaders(result: RateLimitResult) {
  const headers = new Headers({
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
    "Cache-Control": "no-store",
  });

  if (!result.allowed) {
    headers.set("Retry-After", String(result.retryAfterSeconds));
  }

  return headers;
}

export function rateLimitedResponse(
  result: RateLimitResult,
  error = "too_many_requests",
) {
  return Response.json(
    { error, retryAfterSeconds: result.retryAfterSeconds },
    { status: 429, headers: rateLimitHeaders(result) },
  );
}

export function getClientIp(request: Request) {
  const cloudflareIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflareIp) return cloudflareIp;

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwardedFor = request.headers.get("x-forwarded-for");
  const firstForwardedIp = forwardedFor?.split(",")[0]?.trim();
  return firstForwardedIp || "unknown";
}

const apiRateLimiter = new InMemoryRateLimiter({
  namespace: "api-by-ip-v1",
  limit: 120,
  windowMs: 60_000,
});

export function consumeApiRateLimit(request: Request) {
  return apiRateLimiter.consume(getClientIp(request));
}
