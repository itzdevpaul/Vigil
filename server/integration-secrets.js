import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const INTEGRATION_TYPES = Object.freeze({
  slack: { name: "Slack", field: "webhookUrl" },
  pagerduty: { name: "PagerDuty", field: "apiKey" },
  jira: { name: "Jira", field: "apiKey" },
  aws: { name: "AWS Security Hub", field: "apiKey" },
  shodan: { name: "Shodan", field: "apiKey" },
  virustotal: { name: "VirusTotal", field: "apiKey" },
});

const MAX_SECRET_LENGTH = 4096;
const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";

export function decodeIntegrationEncryptionKey(value) {
  if (typeof value !== "string" || !value) {
    throw new Error("Integration secret storage is not configured");
  }

  let key;
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    key = Buffer.from(value, "hex");
  } else if (/^(?:[A-Za-z0-9+/]{4}){10}[A-Za-z0-9+/]{3}=$/.test(value)) {
    key = Buffer.from(value, "base64");
    if (key.toString("base64") !== value) key = null;
  }

  if (!key || key.length !== 32) {
    throw new Error("Integration secret encryption key must decode to exactly 32 bytes");
  }
  return key;
}

export function encryptIntegrationSecret(secret, key, ownerUid, type) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(`${VERSION}:${ownerUid}:${type}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return {
    version: VERSION,
    algorithm: ALGORITHM,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptIntegrationSecret(encrypted, key, ownerUid, type) {
  if (encrypted?.version !== VERSION || encrypted?.algorithm !== ALGORITHM) {
    throw new Error("Unsupported encrypted integration secret format");
  }
  const iv = Buffer.from(encrypted.iv || "", "base64");
  const tag = Buffer.from(encrypted.tag || "", "base64");
  const ciphertext = Buffer.from(encrypted.ciphertext || "", "base64");
  if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) {
    throw new Error("Invalid encrypted integration secret");
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAAD(Buffer.from(`${VERSION}:${ownerUid}:${type}`, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function validateIntegrationRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid integration configuration");
  }
  const keys = Object.keys(body);
  if (keys.length !== 3 || !keys.every((key) => ["name", "type", "secret"].includes(key))) {
    throw new Error("Invalid integration configuration");
  }
  const definition = INTEGRATION_TYPES[body.type];
  if (!definition || body.name !== definition.name) {
    throw new Error("Invalid integration configuration");
  }
  if (typeof body.secret !== "string" || !body.secret.trim() || body.secret.length > MAX_SECRET_LENGTH) {
    throw new Error("Integration secret must be a non-empty string no longer than 4096 characters");
  }
  return { name: definition.name, type: body.type, secret: body.secret };
}

export function integrationDocumentId(uid, type) {
  return `${uid}__${type}`;
}

export function integrationMetadata(record) {
  const definition = INTEGRATION_TYPES[record.type];
  if (!definition) return null;
  return {
    name: definition.name,
    type: record.type,
    configured: true,
    lastFour: typeof record.lastFour === "string" ? record.lastFour.slice(-4) : "",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
  };
}

export function createIntegrationSecretHandlers({ db, deleteField, keyValue = () => process.env.VIGIL_INTEGRATION_ENCRYPTION_KEY }) {
  const getDb = () => typeof db === "function" ? db() : db;
  const metadataFor = (record) => integrationMetadata(record);
  const configuredKey = () => decodeIntegrationEncryptionKey(keyValue());
  const ownerUid = (req) => typeof req.auth?.uid === "string" && req.auth.uid ? req.auth.uid : null;

  return {
    async list(req, res) {
      const uid = ownerUid(req);
      if (!uid) return res.status(401).json({ error: "Authentication required" });
      try {
        configuredKey();
        const snapshot = await getDb().collection("integrationSecrets").where("ownerUid", "==", uid).get();
        const integrations = snapshot.docs
          .filter((item) => item.data().ownerUid === uid)
          .map((item) => metadataFor(item.data()))
          .filter(Boolean);
        return res.json({ integrations });
      } catch (error) {
        return respondForError(res, error);
      }
    },

    async save(req, res) {
      const uid = ownerUid(req);
      if (!uid) return res.status(401).json({ error: "Authentication required" });
      let input;
      let key;
      try {
        input = validateIntegrationRequest(req.body);
        key = configuredKey();
      } catch (error) {
        return respondForError(res, error);
      }

      const record = {
        ownerUid: uid,
        name: input.name,
        type: input.type,
        configured: true,
        lastFour: input.secret.slice(-4),
        encryptedSecret: encryptIntegrationSecret(input.secret, key, uid, input.type),
        updatedAt: new Date().toISOString(),
      };
      try {
        const store = getDb();
        const ref = store.collection("integrationSecrets").doc(integrationDocumentId(uid, input.type));
        await store.runTransaction(async (transaction) => {
          const current = await transaction.get(ref);
          if (current.exists && current.data().ownerUid !== uid) {
            throw new Error("Integration owner mismatch");
          }
          transaction.set(ref, record);
        });
        return res.status(201).json({ integration: metadataFor(record) });
      } catch {
        return res.status(500).json({ error: "Unable to save integration configuration" });
      }
    },

    async remove(req, res) {
      const uid = ownerUid(req);
      if (!uid) return res.status(401).json({ error: "Authentication required" });
      const type = req.params?.type;
      if (!INTEGRATION_TYPES[type]) return res.status(400).json({ error: "Invalid integration type" });
      try {
        configuredKey();
        const store = getDb();
        const ref = store.collection("integrationSecrets").doc(integrationDocumentId(uid, type));
        await store.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(ref);
          if (snapshot.exists && snapshot.data().ownerUid === uid) transaction.delete(ref);
        });
        return res.json({ deleted: true, type });
      } catch (error) {
        return respondForError(res, error);
      }
    },

    async migrateLegacy(req, res) {
      const uid = ownerUid(req);
      if (!uid) return res.status(401).json({ error: "Authentication required" });
      if (req.body !== undefined && (
        !req.body || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length > 0
      )) {
        return res.status(400).json({ error: "Invalid migration request" });
      }
      let key;
      try {
        key = configuredKey();
      } catch (error) {
        return respondForError(res, error);
      }

      try {
        const store = getDb();
        const migrated = await store.runTransaction(async (transaction) => {
          const definitions = Object.entries(INTEGRATION_TYPES);
          const legacyRefs = definitions.map(([type]) => store.collection("integrations").doc(`${uid}_${type}`));
          const secretRefs = definitions.map(([type]) =>
            store.collection("integrationSecrets").doc(integrationDocumentId(uid, type)));
          const legacySnapshots = [];
          for (const ref of legacyRefs) legacySnapshots.push(await transaction.get(ref));
          const secretSnapshots = [];
          for (const ref of secretRefs) secretSnapshots.push(await transaction.get(ref));

          const changes = [];
          for (let index = 0; index < definitions.length; index += 1) {
            const [type, definition] = definitions[index];
            const snapshot = legacySnapshots[index];
            if (!snapshot.exists) continue;
            const legacy = snapshot.data();
            if (legacy.connectedBy !== uid) continue;
            if (legacy.type !== undefined && legacy.type !== type) {
              throw new Error("Legacy integration cannot be migrated safely");
            }
            const secret = legacy[definition.field];
            const hasLegacyCredential = Object.hasOwn(legacy, "apiKey") || Object.hasOwn(legacy, "webhookUrl");
            if (!hasLegacyCredential) continue;
            if (secret === undefined || (definition.field === "apiKey" && legacy.webhookUrl !== undefined)
              || (definition.field === "webhookUrl" && legacy.apiKey !== undefined)) {
              throw new Error("Legacy integration cannot be migrated safely");
            }
            if (typeof secret !== "string" || !secret.trim() || secret.length > MAX_SECRET_LENGTH) {
              throw new Error("Legacy integration cannot be migrated safely");
            }
            const existingRecord = secretSnapshots[index].exists ? secretSnapshots[index].data() : null;
            if (existingRecord && existingRecord.ownerUid !== uid) {
              throw new Error("Integration owner mismatch");
            }
            const record = existingRecord || {
              ownerUid: uid,
              name: definition.name,
              type,
              configured: true,
              lastFour: secret.slice(-4),
              encryptedSecret: encryptIntegrationSecret(secret, key, uid, type),
              updatedAt: new Date().toISOString(),
            };
            changes.push({
              legacyRef: legacyRefs[index],
              secretRef: secretRefs[index],
              secretRecord: record,
              type,
              needsEncryption: !existingRecord,
            });
          }

          for (const change of changes) {
            if (change.needsEncryption) transaction.set(change.secretRef, change.secretRecord);
            transaction.update(change.legacyRef, {
              apiKey: deleteField(),
              webhookUrl: deleteField(),
            });
          }
          return changes.map(({ secretRecord }) => metadataFor(secretRecord));
        });
        return res.json({ migrated });
      } catch {
        return res.status(500).json({ error: "Unable to safely migrate legacy integration configuration" });
      }
    },
  };
}

function respondForError(res, error) {
  if (error?.message === "Integration secret storage is not configured"
    || error?.message === "Integration secret encryption key must decode to exactly 32 bytes") {
    return res.status(503).json({ error: "Secure integration storage is not configured on this server" });
  }
  if (error?.message === "Invalid integration configuration"
    || error?.message?.startsWith("Integration secret must be")) {
    return res.status(400).json({ error: error.message });
  }
  return res.status(500).json({ error: "Unable to process integration configuration" });
}
