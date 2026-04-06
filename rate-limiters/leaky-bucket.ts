import { RequestHandler } from "express-serve-static-core";
import { LRUMap } from "./lru-map";

const config = {
  leakyBucket: {
    bucketSize: 10, // Max 10 requests per window
    leakRate: 1, // Leak 1 request per second
  },
};

type BucketEntry = { tokens: number; lastLeakTime: number; lastSeen: number };

class LeakyBucket {
  private bucketSize: number;
  private leakRate: number;
  private buckets: LRUMap<BucketEntry>;

  constructor(
    bucketSize = config.leakyBucket.bucketSize,
    leakRate = config.leakyBucket.leakRate,
  ) {
    this.bucketSize = bucketSize;
    this.leakRate = leakRate;
    this.buckets = new LRUMap<BucketEntry>({ getLastSeen: (e) => e.lastSeen });
  }

  private shouldAllowRequest(ip: string) {
    const currentTime = Date.now();
    this.buckets.cleanup(currentTime);

    const bucket = this.getOrCreateBucketForIp(ip);
    const timeSinceLastLeak = currentTime - bucket.lastLeakTime;
    const leakedTokens = Math.floor((timeSinceLastLeak / 1000) * this.leakRate);

    bucket.tokens = Math.max(0, bucket.tokens - leakedTokens);

    // Update last leak time based on how many tokens were leaked
    if (leakedTokens > 0) {
      bucket.lastLeakTime += (leakedTokens / this.leakRate) * 1000;
    }

    if (bucket.tokens < this.bucketSize) {
      bucket.tokens += 1;
      bucket.lastSeen = currentTime;
      return true;
    }

    bucket.lastSeen = currentTime;
    return false;
  }

  private getOrCreateBucketForIp(ip: string): BucketEntry {
    let entry = this.buckets.get(ip);
    if (!entry) {
      entry = { tokens: 0, lastLeakTime: Date.now(), lastSeen: Date.now() };
      this.buckets.set(ip, entry);
    }
    return entry;
  }

  private createLeakyBucketMiddleware = (message: string): RequestHandler => {
    return (req, res, next) => {
      const ip = req.ip || req.socket.remoteAddress || "unknown";

      if (this.shouldAllowRequest(ip)) {
        next();
      } else {
        res.status(429).json({ error: message });
      }
    };
  };

  public readonly generalRateLimiter = this.createLeakyBucketMiddleware(
    "Rate limit reached for general requests. Please try again later.",
  );

  getSnapshotForIp(ip: string) {
    const bucket = this.getOrCreateBucketForIp(ip);
    const currentTime = Date.now();
    const timeSinceLastLeak = currentTime - bucket.lastLeakTime;
    const leakedTokens = Math.floor((timeSinceLastLeak / 1000) * this.leakRate);
    const effectiveTokens = Math.max(0, bucket.tokens - leakedTokens);
    const resetsIn =
      effectiveTokens >= this.bucketSize
        ? Math.ceil((1 / this.leakRate) * 1000)
        : 0;

    return {
      tokens: effectiveTokens,
      capacity: this.bucketSize,
      resetsIn,
    };
  }
}

export const rateLimits = new LeakyBucket();
