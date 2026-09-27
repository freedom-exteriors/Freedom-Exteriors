import { hash, verify } from "@node-rs/argon2";

// argon2id with the library defaults (OWASP-recommended range).
export const hashPassword = (password: string) => hash(password);

// Verified against when the email doesn't exist, so login takes the same time either way
// and response timing doesn't reveal which emails have accounts.
let dummyHash: Promise<string> | undefined;

export async function verifyPassword(passwordHash: string | null, password: string): Promise<boolean> {
  if (!passwordHash) {
    dummyHash ??= hash("not-a-real-password-just-for-timing");
    await verify(await dummyHash, password);
    return false;
  }
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
