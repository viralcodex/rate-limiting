import express from "express";
import path from "path";
import { rateLimits as tokenBucketsLimit } from "./rate-limiters/token-buckets";
import { rateLimits as fixedWindowLimits } from "./rate-limiters/fixed-window";
import { rateLimits as slidingLogLimits } from "./rate-limiters/sliding-log";
import { rateLimits as leakyBucketLimits } from "./rate-limiters/leaky-bucket";
import { rateLimits as slidingCounterLimits } from "./rate-limiters/sliding-counter";

export const app = express();
const PORT = 3456;

app.use(express.static(path.join(__dirname, "public")));

// ── Token Bucket ────────────────────────────────────────────
app.get("/api/token-bucket/hit", tokenBucketsLimit.generalRateLimiter, (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const snap = tokenBucketsLimit.getSnapshotForIp(ip);
  const resetsIn = snap.tokens >= snap.capacity ? 0 : Math.ceil((snap.capacity - snap.tokens) / snap.refillRate * 1000);
  res.json({ ok: true, algorithm: "token-bucket", ...snap, resetsIn });
});

app.get("/api/token-bucket/status", (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const snap = tokenBucketsLimit.getSnapshotForIp(ip);
  const resetsIn = snap.tokens >= snap.capacity ? 0 : Math.ceil((snap.capacity - snap.tokens) / snap.refillRate * 1000);
  res.json({ ...snap, resetsIn });
});

// ── Fixed Window ─────────────────────────────────────────────
app.get("/api/fixed-window/hit", fixedWindowLimits.generalRateLimiter, (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const snap = fixedWindowLimits.getSnapshotForIp(ip);
  const remaining = snap.maxRequests - snap.requestCount;
  const resetsIn = remaining >= snap.maxRequests ? 0 : Math.max(0, snap.windowStart + 10000 - Date.now());
  res.json({ ok: true, algorithm: "fixed-window", tokens: remaining, capacity: snap.maxRequests, resetsIn });
});

app.get("/api/fixed-window/status", (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const snap = fixedWindowLimits.getSnapshotForIp(ip);
  const remaining = snap.maxRequests - snap.requestCount;
  const resetsIn = remaining >= snap.maxRequests ? 0 : Math.max(0, snap.windowStart + 10000 - Date.now());
  res.json({ tokens: remaining, capacity: snap.maxRequests, resetsIn });
});

// ── Sliding Window Log ──────────────────────────────────────
app.get("/api/sliding-window-log/hit", slidingLogLimits.generalRateLimiter, (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const snap = slidingLogLimits.getSnapshotForIp(ip);
  const remaining = snap.maxRequests - snap.requestCount;
  const resetsIn = remaining >= snap.maxRequests ? 0 : (snap.oldestTs ? Math.max(0, snap.oldestTs + 10000 - Date.now()) : 0);
  res.json({ ok: true, algorithm: "sliding-window-log", tokens: remaining, capacity: snap.maxRequests, resetsIn });
});

app.get("/api/sliding-window-log/status", (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const snap = slidingLogLimits.getSnapshotForIp(ip);
  const remaining = snap.maxRequests - snap.requestCount;
  const resetsIn = remaining >= snap.maxRequests ? 0 : (snap.oldestTs ? Math.max(0, snap.oldestTs + 10000 - Date.now()) : 0);
  res.json({ tokens: remaining, capacity: snap.maxRequests, resetsIn });
});

// ── Sliding Window Counter ───────────────────────────────────
app.get("/api/sliding-window-counter/hit", slidingCounterLimits.generalRateLimiter, (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const snap = slidingCounterLimits.getSnapshotForIp(ip);
  const remaining = snap.maxRequests - snap.requestCount;
  const resetsIn = remaining >= snap.maxRequests ? 0 : Math.max(0, snap.windowStart + 10000 - Date.now());
  res.json({ ok: true, algorithm: "sliding-window-counter", tokens: remaining, capacity: snap.maxRequests, resetsIn, prevCount: snap.prevCount, currCount: snap.currCount, weight: snap.weight });
});

app.get("/api/sliding-window-counter/status", (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const snap = slidingCounterLimits.getSnapshotForIp(ip);
  const remaining = snap.maxRequests - snap.requestCount;
  const resetsIn = remaining >= snap.maxRequests ? 0 : Math.max(0, snap.windowStart + 10000 - Date.now());
  res.json({ tokens: remaining, capacity: snap.maxRequests, resetsIn, prevCount: snap.prevCount, currCount: snap.currCount, weight: snap.weight });
});

// ── Leaky Bucket ─────────────────────────────────────────────
app.get("/api/leaky-bucket/hit", leakyBucketLimits.generalRateLimiter, (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const snap = leakyBucketLimits.getSnapshotForIp(ip);
  const remaining = snap.capacity - snap.tokens;
  res.json({ ok: true, algorithm: "leaky-bucket", tokens: remaining, capacity: snap.capacity, resetsIn: snap.resetsIn });
});

app.get("/api/leaky-bucket/status", (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const snap = leakyBucketLimits.getSnapshotForIp(ip);
  const remaining = snap.capacity - snap.tokens;
  res.json({ tokens: remaining, capacity: snap.capacity, resetsIn: snap.resetsIn });
});

if (process.env.VERCEL !== "1") {
  app.listen(PORT, () => {
    console.log(`Rate Limiting Dashboard → http://localhost:${PORT}`);
  });
}
