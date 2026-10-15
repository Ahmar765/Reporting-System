import type { RequestHandler } from 'express';
export function securityHeaders(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    }
    next();
  };
}
export function rateLimit({
  windowMs,
  limit
}: {
  windowMs: number;
  limit: number;
  standardHeaders?: string;
  legacyHeaders?: boolean;
  message?: unknown;
}): RequestHandler {
  const buckets = new Map<string, {
    start: number;
    count: number;
  }>();
  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const time = Date.now();
    let value = buckets.get(key);
    if (!value || time - value.start >= windowMs) {
      value = {
        start: time,
        count: 0
      };
      buckets.set(key, value);
    }
    if (buckets.size > 10000) for (const [k, v] of buckets) if (time - v.start >= windowMs) buckets.delete(k);
    if (++value.count > limit) {
      res.setHeader('Retry-After', Math.ceil((windowMs - time + value.start) / 1000));
      res.status(429).json({
        error: 'Too many attempts. Try again later.'
      });
      return;
    }
    next();
  };
}
