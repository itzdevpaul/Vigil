import assert from "node:assert/strict";
import test from "node:test";
import { isSensitiveActionAllowed } from "./auth-policy.js";

test("sensitive actions require an explicitly verified email", () => {
  assert.equal(isSensitiveActionAllowed(true), true);
  assert.equal(isSensitiveActionAllowed(false), false);
  assert.equal(isSensitiveActionAllowed(undefined), false);
  assert.equal(isSensitiveActionAllowed(null), false);
});
