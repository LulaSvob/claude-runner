import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

async function git(
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string }> {
  return execFile("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 });
}

export async function getCurrentBranch(cwd: string): Promise<string> {
  const { stdout } = await git(["branch", "--show-current"], cwd);
  return stdout.trim();
}

export async function validateBranch(
  cwd: string,
  expected: string,
  protectedBranches: string[]
): Promise<{ ok: boolean; current: string; error?: string }> {
  const current = await getCurrentBranch(cwd);

  if (protectedBranches.includes(current)) {
    return {
      ok: false,
      current,
      error: `Refusing to run on protected branch: ${current}`,
    };
  }

  if (current !== expected) {
    return {
      ok: false,
      current,
      error: `Wrong branch: ${current} (expected ${expected})`,
    };
  }

  return { ok: true, current };
}

export async function cleanWorkingTree(cwd: string): Promise<number> {
  const { stdout } = await git(["status", "--porcelain"], cwd);
  const dirtyCount = stdout.trim() ? stdout.trim().split("\n").length : 0;

  if (dirtyCount > 0) {
    await git(["checkout", "--", "."], cwd).catch(() => {});
    await git(["clean", "-fd", "-q"], cwd).catch(() => {});
  }

  return dirtyCount;
}

export async function pullRebase(
  cwd: string,
  branch: string
): Promise<void> {
  await git(["pull", "origin", branch, "--rebase"], cwd);
}

export async function hasChanges(cwd: string): Promise<boolean> {
  try {
    await git(["diff", "--quiet", "HEAD"], cwd);
    const { stdout } = await git(
      ["ls-files", "--others", "--exclude-standard"],
      cwd
    );
    return stdout.trim().length > 0;
  } catch {
    return true;
  }
}

export async function commitAndPush(
  cwd: string,
  branch: string,
  opts: {
    scope: string;
    storyName: string;
    commitTemplate: string;
    coAuthor: string;
  }
): Promise<void> {
  await git(["add", "-A"], cwd);

  const subject = opts.commitTemplate
    .replace("{scope}", opts.scope)
    .replace("{storyName}", opts.storyName);

  const message = `${subject}\n\nAutomated by claude-runner\n\nCo-Authored-By: ${opts.coAuthor}`;

  await git(["commit", "-m", message], cwd);
  await git(["push", "origin", branch], cwd);
}

export async function forceBranch(
  cwd: string,
  branch: string
): Promise<void> {
  const current = await getCurrentBranch(cwd);
  if (current !== branch) {
    await git(["checkout", branch], cwd);
  }
}

export async function hasCommitForStory(
  cwd: string,
  storyName: string
): Promise<boolean> {
  try {
    const { stdout } = await git(
      ["log", "--oneline", `--grep=implement ${storyName}`],
      cwd
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}
