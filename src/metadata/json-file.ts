import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { ZodType } from "zod";

export function readValidatedJson<T>(path: string, schema: ZodType<T>): T {
  const contents = readFileSync(path, "utf8");
  return schema.parse(JSON.parse(contents) as unknown);
}

export function writeJsonAtomically(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}
