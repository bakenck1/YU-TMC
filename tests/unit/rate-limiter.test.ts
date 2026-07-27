import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getClientIp,
  InMemoryRateLimiter,
  rateLimitHeaders,
  resetRateLimitStateForTests,
} from "@/lib/security/rate-limiter";

function limiter(options: { limit?: number; windowMs?: number; maxKeys?: number } = {}) {
  return new InMemoryRateLimiter({
    namespace: `test-${randomUUID()}`,
    limit: options.limit ?? 2,
    windowMs: options.windowMs ?? 1_000,
    maxKeys: options.maxKeys,
  });
}

describe("InMemoryRateLimiter", () => {
  beforeEach(() => resetRateLimitStateForTests());

  it("allows exactly the configured number of consumes", () => {
    const subject = limiter();
    expect(subject.consume("key", 100)).toMatchObject({ allowed: true, remaining: 1 });
    expect(subject.consume("key", 200)).toMatchObject({ allowed: true, remaining: 0 });
    expect(subject.consume("key", 300)).toMatchObject({
      allowed: false,
      remaining: 0,
      resetAt: 1_100,
      retryAfterSeconds: 1,
    });
  });

  it("checks without consuming and resets a key explicitly", () => {
    const subject = limiter();
    expect(subject.check("key", 0).remaining).toBe(2);
    expect(subject.check("key", 10).remaining).toBe(2);
    subject.consume("key", 20);
    expect(subject.check("key", 30).remaining).toBe(1);
    subject.reset("key");
    expect(subject.check("key", 40).remaining).toBe(2);
  });

  it("starts a fresh bucket after the time window", () => {
    const subject = limiter({ limit: 1 });
    expect(subject.consume("key", 1_000).allowed).toBe(true);
    expect(subject.consume("key", 1_999).allowed).toBe(false);
    expect(subject.consume("key", 2_000)).toMatchObject({
      allowed: true,
      remaining: 0,
      resetAt: 3_000,
    });
  });

  it("shares counters only between identical namespaces", () => {
    const namespace = `shared-${randomUUID()}`;
    const first = new InMemoryRateLimiter({ namespace, limit: 2, windowMs: 1_000 });
    const second = new InMemoryRateLimiter({ namespace, limit: 2, windowMs: 1_000 });
    const isolated = new InMemoryRateLimiter({
      namespace: `${namespace}-isolated`,
      limit: 2,
      windowMs: 1_000,
    });

    first.consume("key", 0);
    expect(second.check("key", 1).remaining).toBe(1);
    expect(isolated.check("key", 1).remaining).toBe(2);
  });

  it("evicts the bucket with the earliest reset when capacity is exceeded", () => {
    const subject = limiter({ maxKeys: 2 });
    subject.consume("oldest", 0);
    subject.consume("newer", 100);
    subject.consume("newest", 200);

    expect(subject.check("oldest", 300).remaining).toBe(2);
    expect(subject.check("newer", 300).remaining).toBe(1);
    expect(subject.check("newest", 300).remaining).toBe(1);
  });

  it("emits standard rate limit headers and Retry-After only when blocked", () => {
    const subject = limiter({ limit: 1, windowMs: 5_000 });
    const allowedHeaders = rateLimitHeaders(subject.consume("key", 1_000));
    const blockedHeaders = rateLimitHeaders(subject.consume("key", 2_000));

    expect(allowedHeaders.get("RateLimit-Limit")).toBe("1");
    expect(allowedHeaders.get("RateLimit-Remaining")).toBe("0");
    expect(allowedHeaders.get("Retry-After")).toBeNull();
    expect(blockedHeaders.get("Retry-After")).toBe("4");
    expect(blockedHeaders.get("Cache-Control")).toBe("no-store");
  });
});

describe("getClientIp", () => {
  it("uses the trusted header precedence and the first forwarded address", () => {
    expect(
      getClientIp(
        new Request("http://localhost", {
          headers: {
            "cf-connecting-ip": "203.0.113.1",
            "x-real-ip": "203.0.113.2",
            "x-forwarded-for": "203.0.113.3, 203.0.113.4",
          },
        }),
      ),
    ).toBe("203.0.113.1");
    expect(
      getClientIp(
        new Request("http://localhost", {
          headers: {
            "x-real-ip": "203.0.113.2",
            "x-forwarded-for": "203.0.113.3, 203.0.113.4",
          },
        }),
      ),
    ).toBe("203.0.113.2");
    expect(
      getClientIp(
        new Request("http://localhost", {
          headers: { "x-forwarded-for": "203.0.113.3, 203.0.113.4" },
        }),
      ),
    ).toBe("203.0.113.3");
    expect(getClientIp(new Request("http://localhost"))).toBe("unknown");
  });
});
