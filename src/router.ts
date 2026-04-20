import { GoogleGenAI } from "@google/genai";
import { loadProjects, bySlug, keywordMatch, type Project } from "./projects.ts";
import type { NoteKind } from "./storage.ts";

export type Routed = {
  project: Project;
  kind: NoteKind;
  summary: string;
  confidence: number;
};

function buildSystemPrompt(): string {
  return `You are Foreman's router. Given a short iMessage from the user, return JSON:
{ "slug": "<project slug>", "kind": "note|todo|blocker|decision|idea", "summary": "<<=120 chars>", "confidence": 0..1 }

Project slugs:
${loadProjects()
  .map((p) => `- ${p.slug}: ${p.oneLine}`)
  .join("\n")}

Rules:
- Pick the MOST specific project. Use "inbox" only if truly unrelated.
- "todo" if action to do. "blocker" if stuck. "decision" if a choice made. "idea" if brainstorm. "note" otherwise.
- summary = one-line paraphrase, keep original intent.
- Output ONLY the JSON object, no prose.`;
}

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY not set");
    client = new GoogleGenAI({ apiKey: key });
  }
  return client;
}

export async function route(text: string): Promise<Routed> {
  const fallback = keywordMatch(text);

  try {
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-preview-05-20";
    const res = await getClient().models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: `${buildSystemPrompt()}\n\nMessage: ${text}` }] }],
      config: { responseMimeType: "application/json", temperature: 0 },
    });
    const raw = res.text ?? "{}";
    const parsed = JSON.parse(raw) as {
      slug: string;
      kind: NoteKind;
      summary: string;
      confidence: number;
    };
    const proj = bySlug(parsed.slug) ?? fallback ?? bySlug("inbox")!;
    return {
      project: proj,
      kind: parsed.kind ?? "note",
      summary: parsed.summary ?? text.slice(0, 120),
      confidence: parsed.confidence ?? 0.5,
    };
  } catch {
    return {
      project: fallback ?? bySlug("inbox")!,
      kind: /\b(todo|do:|remind|must|need to)\b/i.test(text) ? "todo" : "note",
      summary: text.slice(0, 120),
      confidence: fallback ? 0.6 : 0.2,
    };
  }
}
