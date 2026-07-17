import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { initializeMysqlStore, isMysqlConfigured, mysqlPool } from "./mysqlStore";

interface EncryptedPayload {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

export async function readIntegrationCredential<T>(provider: string, appKey: string): Promise<T | null> {
  if (!isMysqlConfigured()) return null;
  await initializeMysqlStore();
  const [rows] = await mysqlPool().query<RowDataPacket[]>(
    "SELECT encrypted_payload FROM integration_credentials WHERE provider = ? AND account_scope = 'default' AND app_key_hash = ?",
    [provider, appKeyHash(appKey)]
  );
  if (rows.length === 0) return null;
  const payload = parseJsonValue(rows[0].encrypted_payload) as EncryptedPayload;
  return decrypt<T>(payload);
}

export async function writeIntegrationCredential<T>(provider: string, appKey: string, value: T) {
  if (!isMysqlConfigured()) return;
  await initializeMysqlStore();
  const payload = encrypt(value);
  const metadata = credentialMetadata(value);
  await mysqlPool().query(
    `INSERT INTO integration_credentials
      (provider, account_scope, app_key_hash, encrypted_payload, status, access_expires_at, refresh_expires_at, owner_label)
     VALUES (?, 'default', ?, CAST(? AS JSON), ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE encrypted_payload = VALUES(encrypted_payload), status = VALUES(status),
       access_expires_at = VALUES(access_expires_at), refresh_expires_at = VALUES(refresh_expires_at),
       owner_label = VALUES(owner_label), last_error = NULL`,
    [
      provider,
      appKeyHash(appKey),
      JSON.stringify(payload),
      metadata.status,
      metadata.accessExpiresAt,
      metadata.refreshExpiresAt,
      metadata.owner
    ]
  );
}

function appKeyHash(appKey: string) {
  return createHash("sha256").update(appKey).digest("hex");
}

function encryptionKey() {
  const configured = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!configured || configured.length < 24) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY must be configured with at least 24 characters when using MySQL");
  }
  return createHash("sha256").update(configured).digest();
}

function encrypt<T>(value: T): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

function decrypt<T>(payload: EncryptedPayload): T {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
  return JSON.parse(plaintext) as T;
}

function credentialMetadata(value: unknown) {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const accessToken = typeof record.accessToken === "string" && record.accessToken.length > 0;
  return {
    status: accessToken ? "authorized" : "pending",
    accessExpiresAt: dateOrNull(record.accessTokenExpiresAt),
    refreshExpiresAt: dateOrNull(record.refreshTokenExpiresAt),
    owner: typeof record.resourceOwner === "string" ? record.resourceOwner.slice(0, 160) : null
  };
}

function dateOrNull(value: unknown) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function parseJsonValue(value: unknown) {
  return typeof value === "string" ? JSON.parse(value) : value;
}
