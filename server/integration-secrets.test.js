import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  createIntegrationSecretHandlers,
  decodeIntegrationEncryptionKey,
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  integrationDocumentId,
} from "./integration-secrets.js";

function fakeResponse() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function fakeFirestore() {
  const records = new Map();
  const queryOwnerUids = [];
  const refs = (collectionName) => ({
    doc(id) {
      const path = `${collectionName}/${id}`;
      return {
        path,
        async set(data) { records.set(path, structuredClone(data)); },
      };
    },
    where(field, operator, uid) {
      assert.equal(field, "ownerUid");
      assert.equal(operator, "==");
      queryOwnerUids.push(uid);
      return {
        async get() {
          const docs = [...records.entries()]
            .filter(([path, record]) => path.startsWith(`${collectionName}/`) && record.ownerUid === uid)
            .map(([id, record]) => ({ id, data: () => structuredClone(record) }));
          return { docs };
        },
      };
    },
  });
  const db = {
    collection: refs,
    async runTransaction(callback) {
      const transaction = {
        async get(ref) {
          const value = records.get(ref.path);
          return { exists: value !== undefined, data: () => structuredClone(value) };
        },
        set(ref, data) { records.set(ref.path, structuredClone(data)); },
        delete(ref) { records.delete(ref.path); },
      };
      return callback(transaction);
    },
  };
  return { db, records, queryOwnerUids };
}

test("encryption uses unique IVs and authenticated owner/type-bound ciphertext", () => {
  const key = randomBytes(32);
  const secret = randomBytes(32).toString("base64url");
  const first = encryptIntegrationSecret(secret, key, "owner-a", "jira");
  const second = encryptIntegrationSecret(secret, key, "owner-a", "jira");

  assert.equal(first.version, "v1");
  assert.equal(first.algorithm, "aes-256-gcm");
  assert.equal(first.iv.length, 16);
  assert.equal(first.tag.length, 24);
  assert.notEqual(first.iv, second.iv);
  assert.equal(decryptIntegrationSecret(first, key, "owner-a", "jira"), secret);

  const changed = { ...first, ciphertext: `${first.ciphertext.slice(0, -2)}AA` };
  assert.throws(() => decryptIntegrationSecret(changed, key, "owner-a", "jira"));
  assert.throws(() => decryptIntegrationSecret(first, key, "owner-b", "jira"));
});

test("encryption key accepts precisely 32 decoded bytes in hex or canonical base64", () => {
  const rawKey = randomBytes(32);
  assert.deepEqual(decodeIntegrationEncryptionKey(rawKey.toString("hex")), rawKey);
  assert.deepEqual(decodeIntegrationEncryptionKey(rawKey.toString("base64")), rawKey);
  for (const value of [undefined, "", "not-a-key", rawKey.subarray(0, 31).toString("hex"), "g".repeat(64)]) {
    assert.throws(() => decodeIntegrationEncryptionKey(value));
  }
});

test("save and list use only the verified owner and responses expose metadata only", async () => {
  const { db, records, queryOwnerUids } = fakeFirestore();
  const key = randomBytes(32).toString("base64");
  const handlers = createIntegrationSecretHandlers({ db, keyValue: () => key });
  const secret = randomBytes(48).toString("hex");
  const saveResponse = fakeResponse();
  await handlers.save({
    auth: { uid: "verified-owner" },
    body: { name: "Jira", type: "jira", secret },
  }, saveResponse);

  assert.equal(saveResponse.statusCode, 201);
  assert.equal(JSON.stringify(saveResponse.body).includes(secret), false);
  const record = [...records.values()][0];
  assert.equal(record.ownerUid, "verified-owner");
  assert.equal(record.lastFour, secret.slice(-4));
  assert.equal(JSON.stringify(record).includes(secret), false);
  assert.equal(integrationDocumentId("verified-owner", "jira"), "verified-owner__jira");

  const listResponse = fakeResponse();
  await handlers.list({ auth: { uid: "verified-owner" } }, listResponse);
  assert.deepEqual(queryOwnerUids, ["verified-owner"]);
  assert.deepEqual(listResponse.body.integrations, [{
    name: "Jira",
    type: "jira",
    configured: true,
    lastFour: secret.slice(-4),
    updatedAt: record.updatedAt,
  }]);
});

test("missing identity and unknown request fields fail closed", async () => {
  const { db } = fakeFirestore();
  const handlers = createIntegrationSecretHandlers({
    db,
    keyValue: () => randomBytes(32).toString("hex"),
  });
  const unauthenticated = fakeResponse();
  await handlers.list({}, unauthenticated);
  assert.equal(unauthenticated.statusCode, 401);

  const invalid = fakeResponse();
  await handlers.save({
    auth: { uid: "verified-owner" },
    body: { name: "Jira", type: "jira", secret: randomBytes(32).toString("hex"), uid: "other-owner" },
  }, invalid);
  assert.equal(invalid.statusCode, 400);

  const unconfigured = fakeResponse();
  await createIntegrationSecretHandlers({ db, keyValue: () => undefined }).save({
    auth: { uid: "verified-owner" },
    body: { name: "Jira", type: "jira", secret: randomBytes(32).toString("hex") },
  }, unconfigured);
  assert.equal(unconfigured.statusCode, 503);
});

test("delete derives its document ownership from verified auth and cannot target another owner", async () => {
  const { db, records } = fakeFirestore();
  const handlers = createIntegrationSecretHandlers({
    db,
    keyValue: () => randomBytes(32).toString("hex"),
  });
  const secret = randomBytes(32).toString("hex");
  await handlers.save({
    auth: { uid: "owner-one" },
    body: { name: "Jira", type: "jira", secret },
  }, fakeResponse());

  const otherOwnerResponse = fakeResponse();
  await handlers.remove({ auth: { uid: "owner-two" }, params: { type: "jira" } }, otherOwnerResponse);
  assert.equal(otherOwnerResponse.statusCode, 200);
  assert.equal(records.has("integrationSecrets/owner-one__jira"), true);

  await handlers.remove({ auth: { uid: "owner-one" }, params: { type: "jira" } }, fakeResponse());
  assert.equal(records.has("integrationSecrets/owner-one__jira"), false);
});

test("legacy migration encrypts only the verified owner's credentials and removes plaintext atomically", async () => {
  const records = new Map([
    ["integrations/owner-one_jira", {
      connectedBy: "owner-one", name: "Jira", type: "jira", apiKey: "legacy-secret",
    }],
    ["integrations/owner-two_jira", {
      connectedBy: "owner-two", name: "Jira", type: "jira", apiKey: "other-owner-secret",
    }],
  ]);
  const deleteMarker = Symbol("delete field");
  const db = {
    collection(name) {
      return {
        doc(id) { return { path: `${name}/${id}` }; },
      };
    },
    async runTransaction(callback) {
      const transaction = {
        async get(ref) {
          const value = records.get(ref.path);
          return { exists: value !== undefined, data: () => structuredClone(value) };
        },
        set(ref, data) { records.set(ref.path, structuredClone(data)); },
        update(ref, patch) {
          const updated = { ...records.get(ref.path) };
          for (const [key, value] of Object.entries(patch)) {
            if (value === deleteMarker) delete updated[key];
            else updated[key] = value;
          }
          records.set(ref.path, updated);
        },
      };
      return callback(transaction);
    },
  };
  const handlers = createIntegrationSecretHandlers({
    db,
    deleteField: () => deleteMarker,
    keyValue: () => randomBytes(32).toString("hex"),
  });
  const response = fakeResponse();
  await handlers.migrateLegacy({ auth: { uid: "owner-one" } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.migrated.length, 1);
  assert.equal(JSON.stringify(response.body).includes("legacy-secret"), false);
  assert.equal(records.get("integrations/owner-one_jira").apiKey, undefined);
  assert.equal(records.get("integrations/owner-one_jira").webhookUrl, undefined);
  const migrated = records.get("integrationSecrets/owner-one__jira");
  assert.equal(migrated.ownerUid, "owner-one");
  assert.equal(migrated.encryptedSecret.algorithm, "aes-256-gcm");
  assert.equal(JSON.stringify(migrated).includes("legacy-secret"), false);
  assert.equal(records.get("integrations/owner-two_jira").apiKey, "other-owner-secret");
});
