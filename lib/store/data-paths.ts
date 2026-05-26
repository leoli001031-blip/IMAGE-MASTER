import path from "path";

export function getImageMasterDataDir(): string {
  const configured = process.env.IMAGE_MASTER_DATA_DIR?.trim();
  return configured ? path.resolve(process.cwd(), configured) : path.join(process.cwd(), ".data");
}

export function getImageMasterDbPath(): string {
  return path.join(getImageMasterDataDir(), "image-master.db");
}

export function getGeneratedImagesDir(): string {
  return path.join(getImageMasterDataDir(), "generated");
}
