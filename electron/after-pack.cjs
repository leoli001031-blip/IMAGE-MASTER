const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const sourceNodeModules = path.join(context.packager.projectDir, "dist-electron", "app-server", "node_modules");
  if (!fs.existsSync(sourceNodeModules)) {
    throw new Error(`Missing packaged server node_modules: ${sourceNodeModules}`);
  }

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const targetNodeModules = path.join(
    context.appOutDir,
    appName,
    "Contents",
    "Resources",
    "app-server",
    "node_modules",
  );

  fs.rmSync(targetNodeModules, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetNodeModules), { recursive: true });
  fs.cpSync(sourceNodeModules, targetNodeModules, {
    recursive: true,
    dereference: false,
    preserveTimestamps: true,
  });
};
