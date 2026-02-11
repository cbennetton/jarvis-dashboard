const { 
  RATE_LIMIT_WINDOW_MS, 
  RATE_LIMIT_MAX, 
  LOGIN_RATE_LIMIT_MAX, 
  SETUP_RATE_LIMIT_MAX 
} = require('../config/constants');

// Create a flexible rate limiter
function createRateLimiter({ windowMs, max, keyFn }) {
  const buckets = new Map();
  
  return function rateLimiter(req, res, next) {
    const now = Date.now();
    const key = keyFn ? keyFn(req) : req.ip;
    let bucket = buckets.get(key);
    
    if (!bucket || now > bucket.reset) {
      bucket = { count: 0, reset: now + windowMs };
      buckets.set(key, bucket);
    }
    
    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(remaining));
    res.set('X-RateLimit-Reset', String(Math.ceil(bucket.reset / 1000)));
    
    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.reset - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too many requests', retryAfter });
    }
    
    // Opportunistic cleanup
    if (buckets.size > 5000) {
      for (const [k, v] of buckets.entries()) {
        if (now > v.reset) buckets.delete(k);
      }
    }
    
    next();
  };
}

// Pre-configured rate limiters
const apiLimiter = createRateLimiter({ 
  windowMs: RATE_LIMIT_WINDOW_MS, 
  max: RATE_LIMIT_MAX 
});

const loginLimiter = createRateLimiter({ 
  windowMs: RATE_LIMIT_WINDOW_MS, 
  max: LOGIN_RATE_LIMIT_MAX, 
  keyFn: (req) => `login:${req.ip}` 
});

const setupLimiter = createRateLimiter({ 
  windowMs: RATE_LIMIT_WINDOW_MS, 
  max: SETUP_RATE_LIMIT_MAX, 
  keyFn: (req) => `setup:${req.ip}` 
});

module.exports = {
  createRateLimiter,
  apiLimiter,
  loginLimiter,
  setupLimiter
};
