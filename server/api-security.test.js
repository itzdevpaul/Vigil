import test from "node:test";
import assert from "node:assert/strict";
import {
  createAuthMiddleware,
  createCorsMiddleware,
  createUserRateLimiter,
  getAllowedOrigins,
  redactSecretValues,
} from "./api-security.js";

function response() {
  return {
    headers: {},
    statusCode: 200,
    body: undefined,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

test("origin allowlist uses localhost defaults only outside production", () => {
  assert.ok(getAllowedOrigins(undefined, { production: false }).has("http://localhost:5000"));
  assert.equal(getAllowedOrigins(undefined, { production: true }).size, 0);
  assert.deepEqual(
    [...getAllowedOrigins("https://app.example.test, http://localhost:5000/")],
    ["https://app.example.test", "http://localhost:5000"],
  );
});

test("CORS never reflects arbitrary origins and handles allowed preflight", () => {
  const cors = createCorsMiddleware(new Set(["https://app.example.test"]));
  const rejected = response();
  cors({ headers: { origin: "https://evil.example" }, method: "GET" }, rejected, () => {
    assert.fail("disallowed origin must not continue");
  });
  assert.equal(rejected.statusCode, 403);
  assert.equal(rejected.headers["Access-Control-Allow-Origin"], undefined);

  const preflight = response();
  cors({
    headers: { origin: "https://app.example.test" },
    method: "OPTIONS",
  }, preflight, () => assert.fail("preflight should terminate"));
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers["Access-Control-Allow-Origin"], "https://app.example.test");
  assert.equal(preflight.headers["Access-Control-Allow-Headers"], "Authorization, Content-Type");
});

test("authentication requires a valid bearer token and stores its verified identity", async () => {
  const middleware = createAuthMiddleware(async (token) => {
    if (token !== "valid-token") throw new Error("invalid token");
    return { uid: "user-1", email_verified: true };
  });

  const missing = response();
  await middleware({ headers: {} }, missing, () => assert.fail("must reject missing token"));
  assert.equal(missing.statusCode, 401);

  const invalid = response();
  await middleware({ headers: { authorization: "Bearer invalid-token" } }, invalid, () => {
    assert.fail("must reject invalid token");
  });
  assert.equal(invalid.statusCode, 401);

  const req = { headers: { authorization: "Bearer valid-token" } };
  const accepted = response();
  await middleware(req, accepted, () => { accepted.continued = true; });
  assert.equal(req.auth.uid, "user-1");
  assert.equal(accepted.continued, true);

  const unverifiedMiddleware = createAuthMiddleware(async () => ({
    uid: "user-1", email_verified: false,
  }));
  const unverified = response();
  await unverifiedMiddleware({ headers: { authorization: "Bearer unverified-test-token" } }, unverified, () => {
    assert.fail("unverified accounts must not use protected API routes");
  });
  assert.equal(unverified.statusCode, 403);
});

test("rate limits are per-user, bounded, and return Retry-After", () => {
  let time = 1_000;
  const limiter = createUserRateLimiter({ limit: 2, windowMs: 5_000, maxEntries: 2, now: () => time });
  const call = (uid) => {
    const res = response();
    limiter({ auth: { uid } }, res, () => { res.continued = true; });
    return res;
  };

  assert.equal(call("user-1").statusCode, 200);
  assert.equal(call("user-1").statusCode, 200);
  const limited = call("user-1");
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers["Retry-After"], "5");
  assert.equal(call("user-2").statusCode, 200);
  call("user-3");
  assert.equal(limiter.size, 2);

  time += 5_001;
  assert.equal(call("user-1").statusCode, 200);
});

test("upstream response sanitization removes configured secret values", () => {
  assert.equal(
    redactSecretValues('{"message":"credential/value","encoded":"credential%2Fvalue"}', ["credential/value"]),
    '{"message":"[redacted]","encoded":"[redacted]"}',
  );
  const escapedJson = String.raw`{"message":"cre\u0064ential/value"}`;
  assert.equal(
    redactSecretValues(JSON.stringify(JSON.parse(escapedJson)), ["credential/value"]),
    '{"message":"[redacted]"}',
  );
});
