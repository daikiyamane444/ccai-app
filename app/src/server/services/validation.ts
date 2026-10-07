import { MSG } from "./messages";

export type FieldErrors = Partial<Record<"email" | "password" | "displayName" | "ageConfirmed", string>>;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function validateRegister(input: {
  email: unknown;
  password: unknown;
  displayName: unknown;
  ageConfirmed: unknown;
}): { ok: true; value: { email: string; password: string; displayName: string | null } } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const nameRaw = typeof input.displayName === "string" ? input.displayName.trim() : "";

  if (!email) errors.email = MSG.required;
  else if (!EMAIL_RE.test(email) || email.length > 254) errors.email = MSG.emailFormat;

  if (!password) errors.password = MSG.required;
  else if (password.length < 8) errors.password = MSG.passwordShort;
  else if (password.length > 72) errors.password = MSG.passwordLong;

  if ([...nameRaw].length > 20) errors.displayName = MSG.nameLong;

  if (input.ageConfirmed !== true) errors.ageConfirmed = MSG.ageRequired;

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { email, password, displayName: nameRaw ? nameRaw : null } };
}
