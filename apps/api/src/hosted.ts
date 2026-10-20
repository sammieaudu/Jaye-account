import { timingSafeEqual } from "node:crypto";
import { isAbsolute } from "node:path";
export function hostedMode() {
  return process.env.JAYE_MODE === "hosted";
}
export function validateHosting() {
  if (hostedMode()) {
    if (!process.env.JAYE_API_SECRET || process.env.JAYE_API_SECRET.length < 64)
      throw new Error(
        "Hosted mode requires a strong JAYE_API_SECRET (at least 64 characters).",
      );
    if (
      !process.env.JAYE_DB_PATH ||
      !isAbsolute(process.env.JAYE_DB_PATH) ||
      process.env.JAYE_DB_PATH.startsWith("/tmp/")
    )
      throw new Error(
        "Hosted mode requires an absolute persistent-volume JAYE_DB_PATH.",
      );
  } else if (
    process.env.NODE_ENV === "production" ||
    process.env.JAYE_MODE === "production"
  )
    throw new Error(
      "Production requires explicitly configured hosted mode and authenticated gateway.",
    );
}
export function validServiceKey(value: unknown) {
  const secret = process.env.JAYE_API_SECRET;
  if (!secret || typeof value !== "string") return false;
  const supplied = Buffer.from(value),
    expected = Buffer.from(secret);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}
