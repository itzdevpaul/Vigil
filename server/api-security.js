const DEVELOPMENT_ORIGINS = [
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

export function getAllowedOrigins(value, { production = process.env.NODE_ENV === "production" } = {}) {
  if (value === undefined) return new Set(production ? [] : DEVELOPMENT_ORIGINS);

  const origins = value.split(",").map((item) => item.trim()).filter(Boolean);
  return new Set(origins.map((origin) => {
    const parsed = new URL(origin);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("VIGIL_ALLOWED_ORIGINS must contain HTTP(S) origins");
    }
    return parsed.origin;
  }));
}

export function createCorsMiddleware(allowedOrigins) {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      return res.status(403).json({ error: "Origin not allowed" });
    }

    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Expose-Headers", "Retry-After");
      res.setHeader("Access-Control-Max-Age", "600");
    }

    if (req.method === "OPTIONS") return res.status(204).end();
    return next();
  };
}

export function createAuthMiddleware(verifyIdToken) {
  return async (req, res, next) => {
    const authorization = req.headers.authorization || "";
    const match = /^Bearer ([^\s]+)$/i.exec(authorization);
    if (!match) return res.status(401).json({ error: "Authentication required" });

    let decodedToken;
    try {
      decodedToken = await verifyIdToken(match[1]);
    } catch {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!decodedToken?.uid) return res.status(401).json({ error: "Authentication required" });
    if (decodedToken.email_verified !== true) {
      return res.status(403).json({ error: "Email verification required" });
    }
    req.auth = decodedToken;
    return next();
  };
}

export function createUserRateLimiter({
  limit = 60,
  windowMs = 60_000,
  maxEntries = 10_000,
  now = Date.now,
} = {}) {
  const windows = new Map();

  const middleware = (req, res, next) => {
    const uid = req.auth?.uid;
    if (!uid) return res.status(401).json({ error: "Authentication required" });

    const timestamp = now();
    for (const [key, entry] of windows) {
      if (entry.resetAt <= timestamp) windows.delete(key);
    }

    let entry = windows.get(uid);
    if (!entry || entry.resetAt <= timestamp) {
      if (!entry && windows.size >= maxEntries) {
        const oldestKey = windows.keys().next().value;
        if (oldestKey !== undefined) windows.delete(oldestKey);
      }
      entry = { count: 0, resetAt: timestamp + windowMs };
      windows.set(uid, entry);
    } else {
      windows.delete(uid);
      windows.set(uid, entry);
    }

    if (entry.count >= limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - timestamp) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ error: "Too many requests" });
    }

    entry.count += 1;
    return next();
  };

  Object.defineProperty(middleware, "size", { get: () => windows.size });
  return middleware;
}

export function redactSecretValues(text, secrets) {
  const variants = secrets.filter(Boolean).flatMap((secret) => {
    const unprefixed = secret.replace(/^censys_/, "");
    return [
      secret,
      encodeURIComponent(secret),
      new URLSearchParams({ key: secret }).toString().slice(4),
      Buffer.from(`${secret}:`).toString("base64"),
      Buffer.from(`${unprefixed}:`).toString("base64"),
    ];
  });
  return variants.reduce((result, secret) => result.replaceAll(secret, "[redacted]"), text);
}
