import { RequestHandler } from "express";
import { LRUMap } from "./lru-map";

type BucketState = {
  tokens: number;
  lastRefill: number;
  lastSeen: number;
};

const config = {
  tokenBucket: {
    capacity: 100,
    refillRate: 5,
    cost: 1,
  },
};

class TokenBucket {
  private readonly capacity: number;
  private readonly refillRate: number;
  private readonly buckets: LRUMap<BucketState>;

  constructor(
    capacity = config.tokenBucket.capacity,
    refillRate = config.tokenBucket.refillRate,
  ) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.buckets = new LRUMap<BucketState>({ getLastSeen: (b) => b.lastSeen });
  }

  private getOrCreateBucket(ip: string, now: number) {
    let bucket = this.buckets.get(ip);

    if (!bucket) {
      this.buckets.evictOldest();
      bucket = {
        tokens: this.capacity,
        lastRefill: now,
        lastSeen: now,
      };
      this.buckets.set(ip, bucket);
    }

    return bucket;
  }

  private refill(bucket: BucketState, now: number) {
    const timeElapsedMs = now - bucket.lastRefill;
    const tokensToAdd = (timeElapsedMs / 1000) * this.refillRate;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;
    bucket.lastSeen = now;
  }

  private shouldAllowRequest(ip: string, cost: number) {
    const now = Date.now();
    this.buckets.cleanup(now);

    const bucket = this.getOrCreateBucket(ip, now);
    this.refill(bucket, now);

    if (bucket.tokens < cost) {
      return false;
    }

    bucket.tokens -= cost;
    return true;
  }

  private createTokenBucketMiddleware = (
    cost: number,
    message = "Too many requests, please try again later.",
  ): RequestHandler => {
    return (req, res, next) => {
      const ip = req.ip || req.socket.remoteAddress || "unknown";

      if (this.shouldAllowRequest(ip, cost)) {
        next();
        return;
      }

      res.status(429).json({ error: message });
    };
  };

  public readonly generalRateLimiter = this.createTokenBucketMiddleware(
    config.tokenBucket.cost,
    "Rate limit reached for general requests. Please try again later.",
  );

  getSnapshotForIp = (ip: string) => {
    const now = Date.now();
    this.buckets.cleanup(now);
    const bucket = this.buckets.peek(ip);
    if (bucket) {
      this.refill(bucket, now);
    }
    return {
      capacity: this.capacity,
      refillRate: this.refillRate,
      tokens: bucket ? Math.floor(bucket.tokens) : this.capacity,
      activeBuckets: this.buckets.size,
    };
  };
}

export const rateLimits = new TokenBucket();
