// In-memory sliding-window rate limiter (ต่อ isolate ของ edge function)
// ไม่กันได้ 100% เมื่อ scale หลาย isolate แต่พอตัดการยิงรัว ๆ จาก client เดียวได้
const buckets = new Map<string, { count: number; windowStart: number }>()

export function isRateLimited(req: Request, limit = 20, windowMs = 60_000): boolean {
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim()
  const now = Date.now()
  const bucket = buckets.get(ip)
  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(ip, { count: 1, windowStart: now })
    if (buckets.size > 10_000) {
      for (const [key, value] of buckets) {
        if (now - value.windowStart >= windowMs) buckets.delete(key)
      }
    }
    return false
  }
  bucket.count += 1
  return bucket.count > limit
}
