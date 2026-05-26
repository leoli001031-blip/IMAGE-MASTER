import type { NextConfig } from "next";

const distDir = process.env.NEXT_DIST_DIR || getIsolatedDevDistDir();

const nextConfig: NextConfig = {
  ...(distDir ? { distDir } : {}),
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ["better-sqlite3"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          "**/.data/**",
          "**/.playwright-mcp/**",
          "**/test_artifacts/**",
          "**/*.png",
          "**/*.zip",
        ],
      };
    }

    return config;
  },
};

export default nextConfig;

function getIsolatedDevDistDir(): string | undefined {
  if (!isNextDevCommand()) return undefined;

  const port = getCliOptionValue(["-p", "--port"]) || getCliOptionAssignment("--port");
  if (!port || port === "3000") return undefined;

  return `.next-dev-${sanitizePathSegment(port)}`;
}

function isNextDevCommand(): boolean {
  return process.argv.some((arg) => arg === "dev" || arg.endsWith("/next-dev"));
}

function getCliOptionValue(names: string[]): string | undefined {
  for (const name of names) {
    const index = process.argv.indexOf(name);
    if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  }
  return undefined;
}

function getCliOptionAssignment(name: string): string | undefined {
  const prefix = `${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match?.slice(prefix.length);
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
