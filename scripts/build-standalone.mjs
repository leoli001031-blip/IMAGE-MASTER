#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";

const sourceFiles = ["tsconfig.json", "next-env.d.ts"];
const snapshots = sourceFiles.map((file) => ({
  file,
  exists: fs.existsSync(file),
  contents: fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "",
}));

const result = spawnSync("npm", ["run", "build"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_DIST_DIR: ".next-standalone-build",
    IMAGE_MASTER_STANDALONE: "1",
    IMAGE_MASTER_DATA_DIR: ".data-electron-build",
    NEXT_TELEMETRY_DISABLED: "1",
  },
});

for (const snapshot of snapshots) {
  if (snapshot.exists) {
    fs.writeFileSync(snapshot.file, snapshot.contents);
  } else {
    fs.rmSync(snapshot.file, { force: true });
  }
}

if (result.error) {
  throw result.error;
}

if (result.signal) {
  process.kill(process.pid, result.signal);
} else {
  process.exit(result.status ?? 1);
}
