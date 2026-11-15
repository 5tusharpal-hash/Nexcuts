import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const logsDirectory = resolve(frontendRoot, "logs");
const nextCli = resolve(frontendRoot, "node_modules", "next", "dist", "bin", "next");
mkdirSync(logsDirectory, { recursive: true });

function logFileForToday() {
  return resolve(logsDirectory, `${new Date().toISOString().slice(0, 10)}.log`);
}

function writeLog(stream, text) {
  appendFileSync(logFileForToday(), `${new Date().toISOString()} [${stream}] ${text}`, "utf8");
}

function shouldShowInTerminal(text) {
  const normalized = text.replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, "");
  const isStartupStatus =
    /^\s*[-*]\s+(?:Local|Network):/i.test(normalized) ||
    /^\s*[^\w\s]*Ready\b/i.test(normalized);
  const isError =
    /\b(?:error|fatal|failed|uncaught exception|unhandled)\b/i.test(normalized);
  return isStartupStatus || isError;
}

const child = spawn(process.execPath, [nextCli, "dev"], {
  cwd: frontendRoot,
  env: process.env,
  shell: false,
  stdio: ["inherit", "pipe", "pipe"],
});

function handleStream(streamName, stream, terminalStream) {
  let pending = "";

  function handleLine(line) {
    writeLog(streamName, `${line}\n`);
    if (shouldShowInTerminal(line)) {
      terminalStream.write(`${line}\n`);
    }
  }

  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";

    for (const line of lines) handleLine(line);
  });

  stream.on("end", () => {
    if (!pending) return;
    handleLine(pending);
  });
}

handleStream("stdout", child.stdout, process.stdout);
handleStream("stderr", child.stderr, process.stderr);

child.on("exit", (code, signal) => {
  if (signal) {
    writeLog("system", `Next.js stopped by signal ${signal}\n`);
    process.exitCode = 1;
    return;
  }
  writeLog("system", `Next.js exited with code ${code ?? 0}\n`);
  process.exitCode = code ?? 0;
});

child.on("error", (error) => {
  writeLog("error", `${error.stack ?? error.message}\n`);
  process.stderr.write(`${error.message}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
