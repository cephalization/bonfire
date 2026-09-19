/**
 * Encryption for secrets stored in the database.
 *
 * Provider API keys and agent server passwords are stored with AES-256-GCM
 * under a key derived from `BETTER_AUTH_SECRET`. Rotating that secret makes
 * every stored secret unreadable, so admins would have to re-enter provider
 * keys; that is documented in CLAUDE.md.
 *
 * Format: `v1.<iv>.<auth tag>.<ciphertext>`, each part base64url.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { config } from "./config";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(`bonfire-secrets:${secret}`).digest();
}

export interface SecretBox {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

export function createSecretBox(secret: string = config.authSecret): SecretBox {
  const key = deriveKey(secret);

  return {
    encrypt(plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [
        VERSION,
        iv.toString("base64url"),
        tag.toString("base64url"),
        encrypted.toString("base64url"),
      ].join(".");
    },

    decrypt(ciphertext) {
      const [version, iv, tag, data] = ciphertext.split(".");
      if (version !== VERSION || !iv || !tag || !data) {
        throw new Error("Unrecognized secret format");
      }
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(data, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}

/** The last few characters of a key, for showing which key is configured. */
export function secretHint(secret: string, visible = 4): string {
  const trimmed = secret.trim();
  if (trimmed.length <= visible) return "•".repeat(trimmed.length);
  return `…${trimmed.slice(-visible)}`;
}
