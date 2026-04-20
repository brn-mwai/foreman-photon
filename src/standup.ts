import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { PROJECTS, type Project } from "./projects.ts";
import { readNotes, lastActivity } from "./storage.ts";

const execFileP = promisify(execFile);

function expand(path: string): string {
  return path.replace(/^~/, homedir());
}

async function gitLogSince(repoPath: string, sinceHours: number): Promise<string[]> {
  const abs = expand(repoPath);
  if (!existsSync(abs)) return [];
  try {
    const { stdout } = await execFileP(
      "git",
      ["-C", abs, "log", `--since=${sinceHours} hours ago`, "--pretty=format:%h %s", "-20"],
      { maxBuffer: 1024 * 512 },
    );
    return stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

async function projectStatus(p: Project): Promise<{
  project: Project;
  commits: string[];
  openTodos: string[];
  blockers: string[];
  lastActivityHours: number | null;
}> {
  const commits = p.repoPath ? await gitLogSince(p.repoPath, 24) : [];
  const notes = await readNotes(p.slug, 500);
  const openTodos = notes
    .filter((n) => n.kind === "todo" && !n.done)
    .slice(-3)
    .map((n) => n.text);
  const blockers = notes
    .filter((n) => n.kind === "blocker" && !n.done)
    .slice(-3)
    .map((n) => n.text);
  const last = await lastActivity(p.slug);
  const lastActivityHours = last ? (Date.now() - last) / 3_600_000 : null;
  return { project: p, commits, openTodos, blockers, lastActivityHours };
}

export async function buildStandup(): Promise<string> {
  const staleDays = Number(process.env.STALE_DAYS || "3");
  const active = PROJECTS.filter((p) => p.slug !== "inbox");
  const statuses = await Promise.all(active.map(projectStatus));

  const movers = statuses.filter((s) => s.commits.length > 0 || s.openTodos.length > 0);
  const stale = statuses.filter(
    (s) =>
      s.commits.length === 0 &&
      (s.lastActivityHours === null || s.lastActivityHours > staleDays * 24),
  );

  const lines: string[] = [];
  lines.push(`☕ standup · ${new Date().toLocaleDateString()}`);
  lines.push("");

  if (movers.length === 0) {
    lines.push("no commits, no open todos. quiet.");
  } else {
    for (const s of movers) {
      const parts: string[] = [`▸ ${s.project.name}`];
      if (s.commits.length) parts.push(`  ${s.commits.length} commits last 24h`);
      if (s.blockers.length) parts.push(`  🚨 ${s.blockers[0]}`);
      if (s.openTodos.length) parts.push(`  → ${s.openTodos[0]}`);
      lines.push(parts.join("\n"));
    }
  }

  if (stale.length) {
    lines.push("");
    lines.push(`⚠ stale (>${staleDays}d): ${stale.map((s) => s.project.name).join(", ")}`);
  }

  return lines.join("\n");
}

if (import.meta.main) {
  buildStandup().then((s) => console.log(s));
}
