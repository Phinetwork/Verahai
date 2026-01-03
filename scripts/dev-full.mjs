import { spawn } from "node:child_process";

const env = {
  ...process.env,
  SIGIL_PROOF_API: "external",
  SIGIL_PROOF_API_URL: "http://localhost:8787",
};

const apiProc = spawn("node", ["scripts/dev-api.mjs"], { stdio: "inherit", env });
const viteProc = spawn("vite", [], { stdio: "inherit", env });

const shutdown = (code = 0) => {
  if (!apiProc.killed) apiProc.kill("SIGTERM");
  if (!viteProc.killed) viteProc.kill("SIGTERM");
  process.exit(code);
};

apiProc.on("exit", (code) => shutdown(code ?? 0));
viteProc.on("exit", (code) => shutdown(code ?? 0));

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
