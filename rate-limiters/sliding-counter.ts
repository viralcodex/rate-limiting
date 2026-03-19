import { RequestHandler } from "express-serve-static-core";
import { LRUMap } from "./lru-map";

const config = {
  slidingCounter: {
    windowSize: 10000, // 10 seconds in milliseconds
    maxRequests: 10, // Max 10 requests per window
  },
};

type CounterEntry = {
  previousWindowCount: number;
  currentWindowStart: number;
  currentWindowCount: number;
  lastSeen: number;
};

class SlidingCounter {
  private windowSize: number;
  private requestCounts: LRUMap<CounterEntry>;
  private maxRequests: number;

  constructor(
    windowSize = config.slidingCounter.windowSize,
    maxRequests = config.slidingCounter.maxRequests,
  ) {
    this.windowSize = windowSize;
    this.requestCounts = new LRUMap<CounterEntry>({ getLastSeen: (e) => e.lastSeen });
    this.maxRequests = maxRequests;
  }

  private shouldAllowRequest(ip: string) {
    const currentTime = Date.now();
    this.requestCounts.cleanup(currentTime);
    const ipEntry = this.getOrCreateIpEntry(ip);

    // Check if we need to roll over to the next window
    if (currentTime - ipEntry.currentWindowStart >= this.windowSize) {
      ipEntry.previousWindowCount =
        currentTime - ipEntry.currentWindowStart >= 2 * this.windowSize
          ? 0
          : ipEntry.currentWindowCount;

      ipEntry.currentWindowStart =
        Math.floor(currentTime / this.windowSize) * this.windowSize;

      ipEntry.currentWindowCount = 0;
    }

    // Check BEFORE incrementing
    const elapsedTime = currentTime - ipEntry.currentWindowStart;
    const weight = Math.max(0, (this.windowSize - elapsedTime) / this.windowSize);
    const weightedCount =
      ipEntry.previousWindowCount * weight + ipEntry.currentWindowCount + 1;

    if (weightedCount <= this.maxRequests) {
      ipEntry.currentWindowCount += 1;
      ipEntry.lastSeen = currentTime;
      return true;
    }

    ipEntry.lastSeen = currentTime;
    return false;
  }

  private getOrCreateIpEntry(ip: string): CounterEntry {
    let entry = this.requestCounts.get(ip);
    if (!entry) {
      entry = {
        previousWindowCount: 0,
        currentWindowStart:
          Math.floor(Date.now() / this.windowSize) * this.windowSize,
        currentWindowCount: 0,
        lastSeen: Date.now(),
      };
      this.requestCounts.set(ip, entry);
    }
    return entry;
  }

  private createSlidingCounterMiddleware = (
    message: string,
  ): RequestHandler => {
    return (req, res, next) => {
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (this.shouldAllowRequest(ip)) {
        next();
      } else {
        res.status(429).json({ error: message });
      }
    };
  };

  public readonly generalRateLimiter = this.createSlidingCounterMiddleware(
    "Rate limit reached for general requests. Please try again later.",
  );

  getSnapshotForIp(ip: string) {
    const currentTime = Date.now();
    const ipEntry = this.getOrCreateIpEntry(ip);

    let previousWindowCount = ipEntry.previousWindowCount;
    let currentWindowCount = ipEntry.currentWindowCount;
    let currentWindowStart = ipEntry.currentWindowStart;

    if (currentTime - currentWindowStart >= this.windowSize) {
      previousWindowCount =
        currentTime - currentWindowStart >= 2 * this.windowSize
          ? 0
          : currentWindowCount;
      currentWindowStart =
        Math.floor(currentTime / this.windowSize) * this.windowSize;
      currentWindowCount = 0;
    }

    const elapsed = currentTime - currentWindowStart;
    const weight = Math.max(0, (this.windowSize - elapsed) / this.windowSize);
    const weightedCount = previousWindowCount * weight + currentWindowCount;

    return {
      requestCount: Math.ceil(weightedCount),
      maxRequests: this.maxRequests,
      windowStart: currentWindowStart,
      prevCount: previousWindowCount,
      currCount: currentWindowCount,
      weight: weight,
    };
  }
}

export const rateLimits = new SlidingCounter();
