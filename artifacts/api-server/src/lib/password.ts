import { randomBytes } from "crypto";

/** One-time temporary password for a new staff account, mailed to them and forced to change on first login. */
export function generateTempPassword(): string {
  return randomBytes(9).toString("base64url");
}
