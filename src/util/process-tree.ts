import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

/**
 * Find all descendant PIDs of a given PID using /proc.
 * Returns them in bottom-up order (children before parents).
 */
async function getDescendants(pid: number): Promise<number[]> {
  try {
    const { stdout } = await execFile("ps", [
      "--ppid",
      String(pid),
      "-o",
      "pid=",
    ]);
    const children = stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));

    const allDescendants: number[] = [];
    for (const child of children) {
      const grandchildren = await getDescendants(child);
      allDescendants.push(...grandchildren);
    }
    allDescendants.push(...children);
    return allDescendants;
  } catch {
    return [];
  }
}

/**
 * Kill an entire process tree rooted at `pid`.
 * Sends SIGKILL to all descendants (bottom-up), then to the root.
 */
export async function killProcessTree(pid: number): Promise<number> {
  const descendants = await getDescendants(pid);
  let killed = 0;

  for (const dpid of descendants) {
    try {
      process.kill(dpid, "SIGKILL");
      killed++;
    } catch {
      // Already dead
    }
  }

  try {
    process.kill(pid, "SIGKILL");
    killed++;
  } catch {
    // Already dead
  }

  return killed;
}

/**
 * Find the PID of the SDK's Claude subprocess by matching its command line.
 * We search for processes whose command line contains the debug file path,
 * which is unique per story run.
 */
export async function findSdkChildPid(
  debugFile: string,
): Promise<number | null> {
  try {
    const { stdout } = await execFile("pgrep", ["-f", debugFile]);
    const pids = stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n !== process.pid);
    return pids[0] ?? null;
  } catch {
    return null;
  }
}
