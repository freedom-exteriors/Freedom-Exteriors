// App-layer encryption for OAuth tokens and feed credentials (the *Enc columns):
// AES-256-GCM, key from CREDENTIALS_ENCRYPTION_KEY. Layout: [version=1][iv 12][tag 16][ciphertext].
// GCM authenticates, so a tampered or wrong-key value fails loudly instead of decrypting to junk.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = 1;

export class Crypter {
  private readonly key: Buffer;
  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, "base64");
    if (this.key.length !== 32) throw new Error("CREDENTIALS_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  }

  encrypt(plaintext: string): Uint8Array<ArrayBuffer> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return new Uint8Array(Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ct]));
  }

  decrypt(blob: Uint8Array): string {
    const buf = Buffer.from(blob);
    if (buf[0] !== VERSION) throw new Error("Unknown ciphertext version");
    const decipher = createDecipheriv("aes-256-gcm", this.key, buf.subarray(1, 13));
    decipher.setAuthTag(buf.subarray(13, 29));
    return Buffer.concat([decipher.update(buf.subarray(29)), decipher.final()]).toString("utf8");
  }
}
