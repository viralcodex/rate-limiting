import { RequestHandler } from "express-serve-static-core";
import { LRUMap } from "./lru-map";

const config = {
  slidingLog: {
    windowSize: 10000, // 10 seconds in milliseconds
    maxRequests: 10, // Max 10 requests per window
  },
};

type LogEntry = { timestamps: number[]; lastSeen: number };

class SlidingLog {
  private windowSize: number;
  private requestLogs: LRUMap<LogEntry>;
  private maxRequests: number;

  constructor(
    windowSize = config.slidingLog.windowSize,
    maxRequests = config.slidingLog.maxRequests,
  ) {
    this.windowSize = windowSize;
    this.requestLogs = new LRUMap<LogEntry>({ getLastSeen: (e) => e.lastSeen });
    this.maxRequests = maxRequests;
  }

  private shouldAllowRequest(ip: string) {
    const currentTime = Date.now();
    this.requestLogs.cleanup(currentTime); // Clean up old entries before checking current IP
    
    const entry = this.getOrCreateEntry(ip);
    const logs = entry.timestamps;

    // Remove timestamps outside the window
    while (logs.length > 0 && currentTime - logs[0] >= this.windowSize) {
      logs.shift();
    }
    
    if (logs.length < this.maxRequests) {
      logs.push(currentTime);
      entry.lastSeen = currentTime;
      return true;
    }
    return false;
  }

  private getOrCreateEntry(ip: string): LogEntry {
    let entry = this.requestLogs.get(ip);
    if (!entry) {
      entry = { timestamps: [], lastSeen: Date.now() };
      this.requestLogs.set(ip, entry);
    }
    return entry;
  }

  private createSlidingLogMiddleware = (message: string): RequestHandler => {
    return (req, res, next) => {
      const ip = req.ip || req.socket.remoteAddress || "unknown";

      if (this.shouldAllowRequest(ip)) {
        next();
      } else {
        res.status(429).json({ error: message });
      }
    };
  };

  public readonly generalRateLimiter = this.createSlidingLogMiddleware(
    "Rate limit reached for general requests. Please try again later.",
  );

  getSnapshotForIp(ip: string) {
    const currentTime = Date.now();
    const entry = this.getOrCreateEntry(ip);
    const activeLogs = entry.timestamps.filter(
      (ts) => currentTime - ts < this.windowSize,
    );
    return {
      requestCount: activeLogs.length,
      maxRequests: this.maxRequests,
      oldestTs: activeLogs.length > 0 ? activeLogs[0] : null,
    };
  }
}

export const rateLimits = new SlidingLog();
