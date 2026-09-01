/* Run local project commands without constructing shell-interpreted strings. */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "../..");

export function runCommand(command, arguments_, options = {}) {
  // execFileSync passes every argument directly to the program. Unlike a shell,
  // it does not reinterpret spaces, quotes, semicolons, or generated values.
  const output = execFileSync(command, arguments_, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: options.capture === false ? "inherit" : ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...options.environment },
  });

  // In inherited-output mode Node returns null because nothing was captured.
  return typeof output === "string" ? output.trim() : "";
}

export function compose(arguments_, options = {}) {
  return runCommand("docker", ["compose", ...arguments_], options);
}
