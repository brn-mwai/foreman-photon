import { PROJECTS, bySlug } from "./projects.ts";
import { readNotes, markDone } from "./storage.ts";
import { buildStandup } from "./standup.ts";

export type CommandReply = { text: string; handled: boolean };

const HELP = `foreman commands:
· standup / morning → daily digest
· todos [slug]      → open todos (all or project)
· blockers          → open blockers across projects
· done <id>         → mark note done
· list              → project slugs
· help              → this`;

export async function tryCommand(raw: string): Promise<CommandReply> {
  const text = raw.trim();
  const lower = text.toLowerCase();

  if (/^(help|\?|commands)$/.test(lower)) {
    return { text: HELP, handled: true };
  }

  if (/^(standup|morning|gm|good morning)$/.test(lower)) {
    return { text: await buildStandup(), handled: true };
  }

  if (/^list$/.test(lower)) {
    return {
      text: PROJECTS.map((p) => `${p.slug.padEnd(10)} ${p.name}`).join("\n"),
      handled: true,
    };
  }

  if (/^blockers$/.test(lower)) {
    const all: string[] = [];
    for (const p of PROJECTS) {
      const notes = await readNotes(p.slug, 500);
      const blockers = notes.filter((n) => n.kind === "blocker" && !n.done);
      for (const b of blockers) all.push(`[${p.slug}] ${b.text} · ${b.id}`);
    }
    return { text: all.length ? all.join("\n") : "no blockers. clean.", handled: true };
  }

  const todosMatch = lower.match(/^todos(?:\s+(\w+))?$/);
  if (todosMatch) {
    const slug = todosMatch[1];
    const targets = slug ? [bySlug(slug)].filter(Boolean) : PROJECTS;
    if (slug && targets.length === 0) {
      return { text: `unknown project: ${slug}`, handled: true };
    }
    const out: string[] = [];
    for (const p of targets) {
      const notes = await readNotes(p!.slug, 500);
      const todos = notes.filter((n) => n.kind === "todo" && !n.done).slice(-10);
      if (todos.length) {
        out.push(`▸ ${p!.name}`);
        for (const t of todos) out.push(`  ${t.id}  ${t.text}`);
      }
    }
    return { text: out.length ? out.join("\n") : "no open todos.", handled: true };
  }

  const doneMatch = lower.match(/^done\s+([a-z0-9]+)$/);
  if (doneMatch) {
    const id = doneMatch[1];
    for (const p of PROJECTS) {
      if (await markDone(p.slug, id)) {
        return { text: `✓ done [${p.slug}] ${id}`, handled: true };
      }
    }
    return { text: `not found: ${id}`, handled: true };
  }

  return { text: "", handled: false };
}
