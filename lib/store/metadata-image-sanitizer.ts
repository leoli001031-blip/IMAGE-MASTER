import "server-only";
import crypto from "crypto";
import { storeOutputImage } from "@/lib/store/output-file-store";

const INLINE_IMAGE_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;
const MATERIALIZE_DATA_URL_MIN_LENGTH = 64_000;
const JSON_RESPONSE_STRING_LIMIT = 24_000;
const PERSISTED_STRING_LIMIT = 240_000;
const MAX_DEPTH = 12;

export async function prepareMetadataForPersistence(
  metadata: Record<string, unknown>,
  ownerId: string
): Promise<Record<string, unknown>> {
  const cache = new Map<string, string>();
  const sanitized = await sanitizeForPersistence(metadata, ownerId, cache, 0);
  return isPlainObject(sanitized) ? sanitized : {};
}

export function sanitizePayloadForJson<T>(value: T): T {
  return sanitizeForJson(value, 0) as T;
}

async function sanitizeForPersistence(
  value: unknown,
  ownerId: string,
  cache: Map<string, string>,
  depth: number
): Promise<unknown> {
  if (depth > MAX_DEPTH) return undefined;

  if (typeof value === "string") {
    if (isMaterializedImageCandidate(value)) {
      const cached = cache.get(value);
      if (cached) return cached;

      const hash = crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
      const stored = await storeOutputImage({
        id: `${ownerId}-ref-${hash}`,
        title: "reference",
        url: value,
      });
      cache.set(value, stored.publicUrl);
      return stored.publicUrl;
    }

    return value.length > PERSISTED_STRING_LIMIT
      ? `${value.slice(0, PERSISTED_STRING_LIMIT)}...[truncated ${value.length - PERSISTED_STRING_LIMIT} chars]`
      : value;
  }

  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (const item of value) {
      items.push(await sanitizeForPersistence(item, ownerId, cache, depth + 1));
    }
    return items;
  }

  if (isPlainObject(value)) {
    const entries: Array<[string, unknown]> = [];
    for (const [key, item] of Object.entries(value)) {
      const sanitized = await sanitizeForPersistence(item, ownerId, cache, depth + 1);
      if (sanitized !== undefined) entries.push([key, sanitized]);
    }
    return Object.fromEntries(entries);
  }

  return value;
}

function sanitizeForJson(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return undefined;

  if (typeof value === "string") {
    if (INLINE_IMAGE_RE.test(value)) {
      return `[inline image omitted: ${formatApproxBytes(value)}]`;
    }
    return value.length > JSON_RESPONSE_STRING_LIMIT
      ? `${value.slice(0, JSON_RESPONSE_STRING_LIMIT)}...[truncated ${value.length - JSON_RESPONSE_STRING_LIMIT} chars]`
      : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForJson(item, depth + 1));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, sanitizeForJson(item, depth + 1)] as const)
        .filter(([, item]) => item !== undefined)
    );
  }

  return value;
}

function isMaterializedImageCandidate(value: string): boolean {
  return value.length >= MATERIALIZE_DATA_URL_MIN_LENGTH && INLINE_IMAGE_RE.test(value);
}

function formatApproxBytes(value: string): string {
  const base64 = value.replace(INLINE_IMAGE_RE, "").replace(/\s/g, "");
  const bytes = Math.max(0, Math.floor((base64.length * 3) / 4));
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
