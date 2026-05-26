import { AIError } from "@/lib/ai/client";

export interface ProviderCircuitKey {
  scope: string;
  provider: string;
  model: string;
}

export interface ProviderCircuitStatus {
  key: string;
  open: boolean;
  failureCount: number;
  threshold: number;
  cooldownUntil?: string;
  cooldownRemainingMs: number;
}

interface ProviderCircuitState {
  failureCount: number;
  cooldownUntilMs: number;
  updatedAtMs: number;
}

const circuitStates = new Map<string, ProviderCircuitState>();

export function getProviderCircuitStatus(
  key: ProviderCircuitKey,
  nowMs = Date.now()
): ProviderCircuitStatus {
  const state = circuitStates.get(toCircuitKey(key));
  const threshold = getCircuitFailureThreshold();
  if (!state) {
    return {
      key: toCircuitKey(key),
      open: false,
      failureCount: 0,
      threshold,
      cooldownRemainingMs: 0,
    };
  }

  const cooldownRemainingMs = Math.max(0, state.cooldownUntilMs - nowMs);
  if (cooldownRemainingMs <= 0 && state.cooldownUntilMs > 0) {
    circuitStates.set(toCircuitKey(key), {
      failureCount: 0,
      cooldownUntilMs: 0,
      updatedAtMs: nowMs,
    });
    return {
      key: toCircuitKey(key),
      open: false,
      failureCount: 0,
      threshold,
      cooldownRemainingMs: 0,
    };
  }

  return {
    key: toCircuitKey(key),
    open: cooldownRemainingMs > 0,
    failureCount: state.failureCount,
    threshold,
    cooldownUntil: state.cooldownUntilMs > 0 ? new Date(state.cooldownUntilMs).toISOString() : undefined,
    cooldownRemainingMs,
  };
}

export function assertProviderCircuitAvailable(key: ProviderCircuitKey): void {
  const status = getProviderCircuitStatus(key);
  if (!status.open) return;
  throw new AIError(
    "图片生成服务正在冷却，请稍后重试",
    "PROVIDER_CIRCUIT_OPEN"
  );
}

export function recordProviderCircuitSuccess(key: ProviderCircuitKey): ProviderCircuitStatus {
  circuitStates.delete(toCircuitKey(key));
  return getProviderCircuitStatus(key);
}

export function recordProviderCircuitFailure(
  key: ProviderCircuitKey,
  error: unknown,
  nowMs = Date.now()
): ProviderCircuitStatus {
  const circuitKey = toCircuitKey(key);
  const existing = circuitStates.get(circuitKey) ?? {
    failureCount: 0,
    cooldownUntilMs: 0,
    updatedAtMs: nowMs,
  };

  if (!isCircuitBreakerFailure(error)) {
    circuitStates.set(circuitKey, {
      failureCount: 0,
      cooldownUntilMs: 0,
      updatedAtMs: nowMs,
    });
    return getProviderCircuitStatus(key, nowMs);
  }

  const failureCount = existing.failureCount + 1;
  const threshold = getCircuitFailureThreshold();
  const cooldownUntilMs =
    failureCount >= threshold ? nowMs + getCircuitCooldownMs() : existing.cooldownUntilMs;
  circuitStates.set(circuitKey, {
    failureCount,
    cooldownUntilMs,
    updatedAtMs: nowMs,
  });
  return getProviderCircuitStatus(key, nowMs);
}

export function isCircuitBreakerFailure(error: unknown): boolean {
  if (!(error instanceof AIError)) return false;
  const code = error.code;
  if (
    code === "TIMEOUT" ||
    code === "AI_ERROR" ||
    code === "PROVIDER_SOCKET_CLOSED" ||
    code === "PROVIDER_HEADERS_TIMEOUT" ||
    code === "PROVIDER_NETWORK_ERROR" ||
    code === "IMAGE_GEN_429"
  ) {
    return true;
  }
  const match = code.match(/^IMAGE_GEN_(\d{3})$/);
  if (!match) return false;
  const status = Number(match[1]);
  return status === 429 || (status >= 500 && status <= 599);
}

function toCircuitKey(key: ProviderCircuitKey): string {
  return [key.scope, key.provider, key.model].map((part) => part.trim() || "unknown").join(":");
}

function getCircuitFailureThreshold(): number {
  const configured = Number(process.env.IMAGE_MASTER_PROVIDER_CIRCUIT_FAILURE_THRESHOLD);
  return Number.isInteger(configured) && configured > 0 ? configured : 3;
}

function getCircuitCooldownMs(): number {
  const configured = Number(process.env.IMAGE_MASTER_PROVIDER_CIRCUIT_COOLDOWN_MS);
  return Number.isFinite(configured) && configured >= 1000 ? Math.floor(configured) : 60_000;
}
