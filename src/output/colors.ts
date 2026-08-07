import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const colors = require("kleur") as ColorLibrary;

export function brightBlue(value: string): string {
  return colors.enabled ? `\u001B[94m${value}\u001B[39m` : value;
}

export function brightRed(value: string): string {
  return colors.enabled ? `\u001B[91m${value}\u001B[39m` : value;
}

type ColorLibrary = {
  cyan(value: string): string;
  dim(value: string): string;
  enabled: boolean;
  green(value: string): string;
  yellow(value: string): string;
};
