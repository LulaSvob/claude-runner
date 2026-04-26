import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile, readlink } from "node:fs/promises";

const execFile = promisify(execFileCb);

/**
 * Find all descendant PIDs of a given PID using /proc.
 * Returns them in bottom-up order (children before parents).
 */
export async function getDescendants(pid: number): Promise<number[]> {
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
/**
 * Find and kill orphaned vitest/turbo processes from previous runner attempts.
 * These can survive when the SDK child is killed without propagating to grandchildren.
 */
export async function killStaleTestProcesses(): Promise<number> {
  let killed = 0;
  for (const pattern of ["vitest", "turbo.*run.*test"]) {
    try {
      const { stdout } = await execFile("pgrep", ["-f", pattern]);
      const pids = stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n) && n !== process.pid);

      for (const pid of pids) {
        try {
          process.kill(pid, "SIGKILL");
          killed++;
        } catch {
          // Already dead
        }
      }
    } catch {
      // No matching processes
    }
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

/**
 * Sum the resident-set-size (in bytes) of a process and all its descendants
 * by reading VmRSS from /proc/<pid>/status. Returns 0 if the root is gone.
 */
export async function getRssBytesForTree(rootPid: number): Promise<number> {
  const all = [rootPid, ...(await getDescendants(rootPid))];
  let totalKb = 0;
  for (const pid of all) {
    try {
      const status = await readFile(`/proc/${pid}/status`, "utf-8");
      const m = /^VmRSS:\s+(\d+)\s+kB/m.exec(status);
      if (m) totalKb += parseInt(m[1]!, 10);
    } catch {
      // process is gone or unreadable
    }
  }
  return totalKb * 1024;
}

async function readPpid(pid: number): Promise<number | null> {
  try {
    const status = await readFile(`/proc/${pid}/status`, "utf-8");
    const m = /^PPid:\s+(\d+)/m.exec(status);
    return m ? parseInt(m[1]!, 10) : null;
  } catch {
    return null;
  }
}

async function readCwd(pid: number): Promise<string | null> {
  try {
    return await readlink(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

/**
 * Kill processes orphaned by a previous runner crash:
 * any process whose parent is init (PID 1) AND whose cwd is inside `projectPath`.
 * The init-parent check ensures we don't touch processes belonging to a
 * concurrently-running runner — those are still parented to that runner.
 */
export async function killOrphanProjectProcesses(
  projectPath: string,
): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir("/proc");
  } catch {
    return 0;
  }

  const projectPrefix = projectPath.endsWith("/") ? projectPath : projectPath + "/";
  const ourTree = new Set<number>([process.pid, ...(await getDescendants(process.pid))]);
  const orphans: number[] = [];

  for (const entry of entries) {
    const pid = parseInt(entry, 10);
    if (isNaN(pid) || pid === 1 || ourTree.has(pid)) continue;

    const ppid = await readPpid(pid);
    if (ppid !== 1) continue;

    const cwd = await readCwd(pid);
    if (!cwd) continue;
    if (cwd !== projectPath && !cwd.startsWith(projectPrefix)) continue;

    orphans.push(pid);
  }

  let killed = 0;
  for (const pid of orphans) {
    killed += await killProcessTree(pid);
  }
  return killed;
}
