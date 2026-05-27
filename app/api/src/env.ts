import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Walk up from cwd to the repo root (the dir containing pnpm-workspace.yaml). */
export function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/**
 * Populate process.env from the repo-root .envrc.
 * Supports `KEY=value` and `export KEY=value`. Existing env vars win.
 */
export function loadEnvrc(path = resolve(repoRoot(), ".envrc")): void {
  const target = path;
  if (!existsSync(target)) return;

  for (const raw of readFileSync(target, "utf8").split("\n")) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length);
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function requireEnv(name: string): string {
  if (!process.env[name]) loadEnvrc();
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set (env or .envrc)`);
  return v;
}
