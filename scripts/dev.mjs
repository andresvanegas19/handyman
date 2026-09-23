import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const convexBin = join(dirname(require.resolve("convex/package.json")), "bin/main.js");

/** @param {Record<string, string | undefined>} env */
export function repairLogArgs(env) {
  if (!env.NEXT_PUBLIC_CONVEX_URL) return null;
  const url = new URL(env.NEXT_PUBLIC_CONVEX_URL);
  const cloud = /^([a-z0-9-]+)\.convex\.cloud$/.exec(url.hostname);
  if (cloud) return ["logs", "--history", "10", "--deployment", cloud[1]];
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    if (env.CONVEX_DEPLOYMENT?.startsWith("anonymous:")) return ["logs", "--history", "10"];
    return ["logs", "--history", "10", "--deployment", "local"];
  }
  if (env.CONVEX_SELF_HOSTED_URL === env.NEXT_PUBLIC_CONVEX_URL) return ["logs", "--history", "10"];
  throw new Error("Custom Convex URL: use npm run convex:logs with the matching deployment in another terminal.");
}

/** @param {string[]} args @param {Record<string, string | undefined>} env */
export function startDev(args = [], env = process.env) {
  /** @type {Set<import("node:child_process").ChildProcess>} */
  const children = new Set();
  let stopping = false;
  const interrupt = () => stop(130, "SIGINT");
  const terminate = () => stop(143);

  /** @param {number} code @param {NodeJS.Signals} signal */
  function stop(code = 0, signal = "SIGTERM") {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    for (const child of children) child.kill(signal);
  }

  /** @param {string} bin @param {string[]} argv @param {boolean} frontend */
  function launch(bin, argv, frontend) {
    const child = spawn(process.execPath, [bin, ...argv], {
      env, stdio: [frontend ? "inherit" : "ignore", "inherit", "inherit"],
    });
    children.add(child);
    child.once("error", () => {
      children.delete(child);
      if (stopping) return;
      console.error(frontend ? "[dev] Next.js could not start." :
        "[repair] ERROR Log stream could not start. Run npm run convex:logs to diagnose.");
      if (frontend) stop(1);
    });
    child.once("exit", (code, signal) => {
      children.delete(child);
      if (stopping) return;
      if (frontend) stop(code ?? (signal === "SIGINT" ? 130 : 1));
      else console.error(`[repair] ERROR Log stream stopped (${code ?? signal}). Backend logs are no longer visible. Check Convex login/connectivity and restart npm run dev.`);
    });
  }

  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  launch(nextBin, ["dev", ...args], true);
  // Help/version should behave like Next.js, without starting a log connection.
  if (args.some(arg => ["--help", "-h", "--version", "-v"].includes(arg))) return stop;
  let logs;
  try { logs = repairLogArgs(env); }
  catch {
    console.error("[repair] ERROR Cannot select the backend log deployment. Use npm run convex:logs with the matching deployment in another terminal.");
    return stop;
  }
  if (logs) {
    if (env.NEXT_PUBLIC_VISUAL_REPAIR_ENABLED !== "true") {
      console.warn("[repair] Visual intake is disabled. Set NEXT_PUBLIC_VISUAL_REPAIR_ENABLED=true after backend setup, then restart.");
    }
    console.info("[repair] Connecting backend logs to this terminal (read-only; no deployment or paid requests).");
    launch(convexBin, logs, false);
  } else console.info("[repair] Temporary mode: no Convex backend configured, so there are no backend logs.");
  return stop;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Use the same .env precedence and expansion as Next.js, not a second parser.
  const nextRequire = createRequire(require.resolve("next/package.json"));
  nextRequire("@next/env").loadEnvConfig(process.cwd(), true);
  startDev(process.argv.slice(2));
}
