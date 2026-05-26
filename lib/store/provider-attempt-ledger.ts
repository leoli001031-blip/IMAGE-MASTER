import crypto from "crypto";

export type ProviderAttemptStatus = "started" | "succeeded" | "failed";

export interface ProviderAttemptEntry {
  attemptId: string;
  scope: string;
  status: ProviderAttemptStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  runId?: string;
  jobId?: string;
  providerRequestId?: string;
  inputHash: string;
  promptHash: string;
  referenceImageUrl?: string;
  referenceImageUrls?: string[];
  providerReferenceCount?: number;
  providerReferenceRole?: string;
  providerReferenceStrategy?: string;
  errorCode?: string;
  errorMessage?: string;
  diagnostics?: unknown;
  outputUrl?: string;
  outputSha256?: string;
}

export interface CreateProviderAttemptInput {
  scope: string;
  prompt: string;
  runId?: string;
  jobId?: string;
  referenceImageUrl?: string;
  referenceImageUrls?: string[];
  providerReferenceCount?: number;
  providerReferenceRole?: string;
  providerReferenceStrategy?: string;
  providerRequestId?: string;
  now?: string;
}

const MAX_LEDGER_ENTRIES = 50;

export function createProviderAttemptEntry(input: CreateProviderAttemptInput): ProviderAttemptEntry {
  const startedAt = input.now ?? new Date().toISOString();
  const promptHash = sha256(input.prompt);
  const referenceImageUrls = normalizeReferenceImageUrls(
    input.referenceImageUrls ?? (input.referenceImageUrl ? [input.referenceImageUrl] : [])
  );
  const inputHash = sha256([
    input.scope,
    input.jobId ?? "",
    input.runId ?? "",
    promptHash,
    referenceImageUrls.join(","),
    input.providerReferenceRole ?? "",
    input.providerReferenceStrategy ?? "",
  ].join("|"));

  return {
    attemptId: `attempt_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    scope: input.scope,
    status: "started",
    startedAt,
    runId: input.runId,
    jobId: input.jobId,
    providerRequestId: input.providerRequestId,
    inputHash,
    promptHash,
    referenceImageUrl: input.referenceImageUrl ?? referenceImageUrls[0],
    referenceImageUrls: referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
    providerReferenceCount: input.providerReferenceCount ?? referenceImageUrls.length,
    providerReferenceRole: input.providerReferenceRole,
    providerReferenceStrategy: input.providerReferenceStrategy,
  };
}

export function finishProviderAttemptEntry(
  entry: ProviderAttemptEntry,
  update: {
    status: Exclude<ProviderAttemptStatus, "started">;
    errorCode?: string;
    errorMessage?: string;
    diagnostics?: unknown;
    outputUrl?: string;
    outputSha256?: string;
    now?: string;
  }
): ProviderAttemptEntry {
  const finishedAt = update.now ?? new Date().toISOString();
  return {
    ...entry,
    status: update.status,
    finishedAt,
    durationMs: Math.max(0, new Date(finishedAt).getTime() - new Date(entry.startedAt).getTime()),
    errorCode: update.errorCode,
    errorMessage: update.errorMessage,
    diagnostics: update.diagnostics,
    outputUrl: update.outputUrl,
    outputSha256: update.outputSha256 ?? (update.outputUrl ? sha256(update.outputUrl) : undefined),
  };
}

export function appendProviderAttemptLedger(
  metadata: Record<string, unknown> | undefined,
  entries: ProviderAttemptEntry | ProviderAttemptEntry[]
): Record<string, unknown> {
  const nextEntries = Array.isArray(entries) ? entries : [entries];
  const existing = Array.isArray(metadata?.providerAttemptLedger)
    ? metadata.providerAttemptLedger.filter(isProviderAttemptEntry)
    : [];
  const ledger = [...existing, ...nextEntries].slice(-MAX_LEDGER_ENTRIES);
  const latest = ledger[ledger.length - 1];

  return {
    ...(metadata ?? {}),
    providerAttemptLedger: ledger,
    lastProviderAttemptId: latest?.attemptId,
    lastProviderAttemptStatus: latest?.status,
  };
}

function isProviderAttemptEntry(value: unknown): value is ProviderAttemptEntry {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    typeof (value as ProviderAttemptEntry).attemptId === "string";
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeReferenceImageUrls(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
