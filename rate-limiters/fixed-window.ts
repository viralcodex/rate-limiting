import { RequestHandler } from "express-serve-static-core";
import { LRUMap } from "./lru-map";

const config = {
  fixedWindow: {
    windowSize: 10000, // 10 seconds in milliseconds
    maxRequests: 10, // Max 10 requests per window
  },
};

type WindowEntry = { windowStart: number; count: number; lastSeen: number };

class FixedWindow {
  private windowSize: number;
  private requestCount: LRUMap<WindowEntry>;
  private maxRequests: number;

  constructor(
    windowSize = config.fixedWindow.windowSize,
    maxRequests = config.fixedWindow.maxRequests,
  ) {
    this.windowSize = windowSize;
    this.requestCount = new LRUMap<WindowEntry>({ getLastSeen: (e) => e.lastSeen });
    this.maxRequests = maxRequests;
  }

  private shouldAllowRequest(ip: string) {
    const currentTime = Date.now();
    this.requestCount.cleanup(currentTime);
    const ipEntry = this.getOrCreateIpEntry(ip);

    // Window has expired, reset count and window start time
    if (currentTime - ipEntry.windowStart >= this.windowSize) {
      ipEntry.windowStart = Math.floor(currentTime / this.windowSize) * this.windowSize;
      ipEntry.count = 1;
      ipEntry.lastSeen = currentTime;
      return true;
    }

    // Increment count and allow request
    if (ipEntry.count < this.maxRequests) {
      ipEntry.count += 1;
      ipEntry.lastSeen = currentTime;
      return true;
    }

    // Rate limit exceeded
    return false;
  }

  private getOrCreateIpEntry(ip: string): WindowEntry {
    let entry = this.requestCount.get(ip);
    if (!entry) {
      entry = {
        windowStart: Math.floor(Date.now() / this.windowSize) * this.windowSize,
        count: 0,
        lastSeen: Date.now(),
      };
      this.requestCount.set(ip, entry);
    }
    return entry;
  }

  private createFixedWindowMiddleware = (
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

  public readonly generalRateLimiter = this.createFixedWindowMiddleware(
    "Rate limit reached for general requests. Please try again later.",
  );

  public readonly getSnapshotForIp = (ip: string) => {
    const ipEntry = this.getOrCreateIpEntry(ip);
    const windowExpired = Date.now() - ipEntry.windowStart >= this.windowSize;
    return {
      windowStart: windowExpired ? Date.now() : ipEntry.windowStart,
      requestCount: windowExpired ? 0 : ipEntry.count,
      maxRequests: this.maxRequests,
    };
  };
}

export const rateLimits = new FixedWindow();
