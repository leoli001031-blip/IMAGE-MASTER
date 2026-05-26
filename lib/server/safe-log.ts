export function safeLogError(scope: string, error: unknown): void {
  if (error instanceof Error) {
    console.error(`${scope}:`, error.name, redactSensitiveText(error.message));
    return;
  }

  if (typeof error === "string") {
    console.error(`${scope}:`, redactSensitiveText(error));
    return;
  }

  console.error(`${scope}:`, Object.prototype.toString.call(error));
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=_-]+/gi, "[redacted-image-data]")
    .replace(/\bsk-proj-[a-z0-9_-]{12,}\b/gi, "[redacted-api-key]")
    .replace(/\bsk-[a-z0-9_-]{12,}\b/gi, "[redacted-api-key]")
    .slice(0, 1200);
}
