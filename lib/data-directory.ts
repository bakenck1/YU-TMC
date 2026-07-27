import path from "node:path";

export function dataDirectory() {
  const configured = process.env.YU_DATA_DIRECTORY?.trim();
  return configured
    ? path.resolve(configured)
    : path.join(process.cwd(), ".data");
}
