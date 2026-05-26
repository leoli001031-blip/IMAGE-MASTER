import { spawn } from "node:child_process";

const port = Number(process.env.REVIEW_SESSION_SMOKE_PORT || 3468);
const baseUrl = `http://127.0.0.1:${port}`;
const createdIds = [];

const server = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

try {
  await waitForServer(`${baseUrl}/api/review-sessions?demo=1&limit=1`);

  const stamp = Date.now();
  const payload = await requestJson(`${baseUrl}/api/review-sessions`, {
    method: "POST",
    body: JSON.stringify({
      title: `Smoke review session ${stamp}`,
      items: [
        {
          id: `smoke-main-${stamp}`,
          title: "Smoke main image",
          imageUrl: "https://example.com/smoke-main.png",
          status: "pending",
          sourceId: `job-main-${stamp}`,
        },
        {
          id: `smoke-detail-${stamp}`,
          title: "Smoke detail image",
          imageUrl: "https://example.com/smoke-detail.png",
          status: "pending",
          sourceId: `job-detail-${stamp}`,
        },
        {
          id: `smoke-reject-${stamp}`,
          title: "Smoke rejected image",
          imageUrl: "https://example.com/smoke-reject.png",
          status: "pending",
          sourceId: `job-reject-${stamp}`,
        },
      ],
      qualityChecks: [
        {
          id: `check-size-${stamp}`,
          itemId: `smoke-main-${stamp}`,
          label: "Size",
          status: "pass",
          message: "Size meets export requirement.",
        },
        {
          id: `check-copy-${stamp}`,
          itemId: `smoke-detail-${stamp}`,
          label: "Copy policy",
          status: "warn",
          severity: "medium",
          message: "Manual copy review required.",
        },
      ],
      notes: ["Created by smoke-review-sessions; safe to delete."],
      metadata: { source: "smoke-review-sessions", stamp },
    }),
  });

  const session = payload.session;
  if (!payload.persisted || !session?.id) throw new Error("Expected persisted review session");
  createdIds.push(session.id);

  assertSession(session, stamp);

  const approvePayload = await requestJson(
    `${baseUrl}/api/review-sessions?id=${encodeURIComponent(session.id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        action: "approve_item",
        itemId: `smoke-main-${stamp}`,
        note: "Main image approved by smoke test.",
        metadata: { source: "smoke-review-sessions", step: "approve" },
      }),
    }
  );
  assertPatchedSession(approvePayload.session, {
    itemId: `smoke-main-${stamp}`,
    status: "approved",
    note: "Main image approved by smoke test.",
  });

  const revisionPayload = await requestJson(
    `${baseUrl}/api/review-sessions?id=${encodeURIComponent(session.id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        action: "request_revision",
        itemId: `smoke-detail-${stamp}`,
        note: "Detail image needs copy revision.",
        metadata: { source: "smoke-review-sessions", step: "revision" },
      }),
    }
  );
  assertPatchedSession(revisionPayload.session, {
    itemId: `smoke-detail-${stamp}`,
    status: "needs_revision",
    note: "Detail image needs copy revision.",
  });

  const rejectPayload = await requestJson(
    `${baseUrl}/api/review-sessions?id=${encodeURIComponent(session.id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        action: "reject_item",
        itemId: `smoke-reject-${stamp}`,
        note: "Rejected by smoke test.",
        metadata: { source: "smoke-review-sessions", step: "reject" },
      }),
    }
  );
  assertPatchedSession(rejectPayload.session, {
    itemId: `smoke-reject-${stamp}`,
    status: "rejected",
    note: "Rejected by smoke test.",
  });

  const notePayload = await requestJson(
    `${baseUrl}/api/review-sessions?id=${encodeURIComponent(session.id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        action: "add_note",
        note: "Session-level note from smoke test.",
        metadata: { source: "smoke-review-sessions", step: "note" },
      }),
    }
  );
  assertPatchedSession(notePayload.session, {
    note: "Session-level note from smoke test.",
  });

  const readPayload = await requestJson(`${baseUrl}/api/review-sessions?id=${session.id}`);
  assertPatchedSession(readPayload.session, {
    itemId: `smoke-main-${stamp}`,
    status: "approved",
    note: "Session-level note from smoke test.",
  });
  if (readPayload.session.statusCounters?.approved !== 1) {
    throw new Error("Expected one approved item after PATCH");
  }
  if (readPayload.session.statusCounters?.needsRevision !== 1) {
    throw new Error("Expected one revision item after PATCH");
  }
  if (readPayload.session.statusCounters?.rejected !== 1) {
    throw new Error("Expected one rejected item after PATCH");
  }

  const listPayload = await requestJson(`${baseUrl}/api/review-sessions?demo=1&limit=5`);
  if (!Array.isArray(listPayload.sessions)) throw new Error("Expected sessions list");
  if (!listPayload.sessions.some((item) => item.id === session.id)) {
    throw new Error("Created session missing from list");
  }
  if (listPayload.demoSession?.metadata?.source !== "demo") {
    throw new Error("Expected deterministic demo session");
  }

  console.log(
    `Review session smoke passed on ${baseUrl}: ${session.id}, ` +
      `${session.statusCounters.total} items, ${session.qualitySummary.total} checks.`
  );
} finally {
  await cleanup();
  server.kill("SIGTERM");
}

function assertSession(session, stamp) {
  if (!session || typeof session !== "object") throw new Error("Session payload missing");
  if (session.title !== `Smoke review session ${stamp}`) throw new Error("Session title mismatch");
  if (session.status !== "in_review") throw new Error(`Unexpected status: ${session.status}`);
  if (session.statusCounters?.total !== 3) throw new Error("Expected three review items");
  if (session.statusCounters?.pending !== 3) throw new Error("Expected three pending items");
  if (!Array.isArray(session.itemList) || session.itemList.length !== 3) {
    throw new Error("Expected itemList with three items");
  }
  if (session.qualitySummary?.passed !== 1 || session.qualitySummary?.warning !== 1) {
    throw new Error("Quality summary mismatch");
  }
  if (!Array.isArray(session.reviewActions) || session.reviewActions.length === 0) {
    throw new Error("Expected review actions");
  }
  if (!Array.isArray(session.history) || session.history[0]?.type !== "created") {
    throw new Error("Expected created history entry");
  }
}

function assertPatchedSession(session, expectation) {
  if (!session || typeof session !== "object") throw new Error("Patched session payload missing");
  if (!Array.isArray(session.itemList)) throw new Error("Patched session missing itemList");
  if (!Array.isArray(session.history)) throw new Error("Patched session missing history");
  if (!Array.isArray(session.notes)) throw new Error("Patched session missing notes");
  if (expectation.itemId) {
    const item = session.itemList.find((candidate) => candidate.id === expectation.itemId);
    if (!item) throw new Error(`Missing patched item ${expectation.itemId}`);
    if (item.status !== expectation.status) {
      throw new Error(`Expected ${expectation.itemId} status ${expectation.status}, got ${item.status}`);
    }
  }
  if (expectation.note && !session.notes.includes(expectation.note)) {
    throw new Error(`Missing note: ${expectation.note}`);
  }
  if (!session.history.some((entry) => entry.metadata?.note === expectation.note)) {
    throw new Error(`Missing history entry for note: ${expectation.note}`);
  }
}

async function cleanup() {
  for (const id of createdIds.reverse()) {
    try {
      await fetch(`${baseUrl}/api/review-sessions?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    } catch {
      // Best effort cleanup; failures should not hide the primary smoke result.
    }
  }
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) break;
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`Next dev server did not become ready.\n${serverOutput.slice(-2000)}`);
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`${init.method || "GET"} ${url} failed with ${response.status}`);
  }
  return response.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
