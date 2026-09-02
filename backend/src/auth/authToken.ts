/* Create login-cookie tokens and one-way database fingerprints for those tokens. */
import { createHash, randomBytes } from "node:crypto";

export function createAuthenticationToken(): string {
  // Thirty-two random bytes provide 256 bits of entropy. base64url represents
  // those bytes without characters that require special handling in cookies.
  return randomBytes(32).toString("base64url");
}

export function hashAuthenticationToken(token: string): string {
  /*
   * Session tokens are already high-entropy random values, so a fast SHA-256
   * fingerprint is appropriate here. Passwords are human-chosen and therefore
   * use the much slower scrypt function in password.ts instead.
   */
  return createHash("sha256").update(token).digest("hex");
}
