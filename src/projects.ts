import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type Project = {
  slug: string;
  name: string;
  aliases: string[];
  repoPath?: string;
  oneLine: string;
};

const DEFAULT_PROJECTS: Project[] = [
  {
    slug: "work",
    name: "Work",
    aliases: ["work", "job", "office"],
    oneLine: "Day-job notes and todos.",
  },
  {
    slug: "personal",
    name: "Personal",
    aliases: ["personal", "life", "home"],
    oneLine: "Personal tasks and reminders.",
  },
  {
    slug: "inbox",
    name: "Inbox",
    aliases: ["inbox", "misc", "random", "other"],
    oneLine: "Unrouted / general notes.",
  },
];

let cache: Project[] | null = null;

function configPath(): string {
  const root =
    process.env.FOREMAN_HOME?.replace(/^~/, homedir()) || join(homedir(), ".foreman");
  return join(root, "projects.json");
}

export function loadProjects(): Project[] {
  if (cache) return cache;
  const path = configPath();
  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw) as Project[];
      if (Array.isArray(parsed) && parsed.length) {
        if (!parsed.some((p) => p.slug === "inbox")) {
          parsed.push({
            slug: "inbox",
            name: "Inbox",
            aliases: ["inbox", "misc", "other"],
            oneLine: "Unrouted / general notes.",
          });
        }
        cache = parsed;
        return cache;
      }
    } catch (e) {
      console.warn(`projects.json invalid, using defaults: ${(e as Error).message}`);
    }
  }
  cache = DEFAULT_PROJECTS;
  return cache;
}

export function bySlug(slug: string): Project | undefined {
  return loadProjects().find((p) => p.slug === slug);
}

export function keywordMatch(text: string): Project | undefined {
  const lower = text.toLowerCase();
  for (const p of loadProjects()) {
    for (const a of p.aliases) {
      if (lower.includes(a.toLowerCase())) return p;
    }
  }
  return undefined;
}
