import { mkdir, readFile, writeFile, appendFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type NoteKind = "note" | "todo" | "blocker" | "decision" | "idea";

export type Note = {
  id: string;
  ts: number;
  kind: NoteKind;
  text: string;
  done?: boolean;
  source: "imessage";
};

const root = (): string =>
  process.env.FOREMAN_HOME?.replace(/^~/, homedir()) || join(homedir(), ".foreman");

const projectDir = (slug: string): string => join(root(), "projects", slug);
const notesFile = (slug: string): string => join(projectDir(slug), "notes.jsonl");

export async function ensureDirs(slug: string): Promise<void> {
  await mkdir(projectDir(slug), { recursive: true });
}

export async function appendNote(slug: string, n: Note): Promise<void> {
  await ensureDirs(slug);
  await appendFile(notesFile(slug), JSON.stringify(n) + "\n", "utf8");
}

export async function readNotes(slug: string, limit = 500): Promise<Note[]> {
  const path = notesFile(slug);
  if (!existsSync(path)) return [];
  const raw = await readFile(path, "utf8");
  const lines = raw.trim().split("\n").filter(Boolean);
  const notes = lines.map((l) => JSON.parse(l) as Note);
  return notes.slice(-limit);
}

export async function markDone(slug: string, id: string): Promise<boolean> {
  const notes = await readNotes(slug, 10000);
  const idx = notes.findIndex((n) => n.id === id);
  if (idx === -1) return false;
  notes[idx].done = true;
  await writeFile(notesFile(slug), notes.map((n) => JSON.stringify(n)).join("\n") + "\n");
  return true;
}

export async function lastActivity(slug: string): Promise<number | null> {
  const path = notesFile(slug);
  if (!existsSync(path)) return null;
  const s = await stat(path);
  return s.mtimeMs;
}

export async function allProjectSlugs(): Promise<string[]> {
  const dir = join(root(), "projects");
  if (!existsSync(dir)) return [];
  return readdir(dir);
}

export function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
