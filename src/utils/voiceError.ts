/** Firefox workers reject with plain objects, and errors can cross realms.
 * Read only known fields; never serialize arbitrary speech/auth error payloads. */
export function getVoiceErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string") return error.trim() || fallback;
  if (!error || typeof error !== "object") return fallback;
  try {
    const value = error as { message?: unknown; errorCode?: unknown };
    const message =
      typeof value.message === "string" && value.message.trim()
        ? value.message.trim()
        : fallback;
    const code = value.errorCode;
    return typeof code === "number" ||
      (typeof code === "string" && /^[\w-]{1,40}$/.test(code))
      ? `${message} (code ${code})`
      : message;
  } catch {
    return fallback;
  }
}
