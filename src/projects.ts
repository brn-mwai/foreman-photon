export type Project = {
  slug: string;
  name: string;
  aliases: string[];
  repoPath?: string;
  oneLine: string;
};

export const PROJECTS: Project[] = [
  {
    slug: "axi",
    name: "AXI Mobility",
    aliases: ["axi", "atlas", "fleet", "mobility"],
    repoPath: "~/OneDrive/Documents/AXI-Workspace/axi-website/axi-website/axi-app",
    oneLine: "AI-native fleet OS. Atlas = autonomous agent for fleet ops.",
  },
  {
    slug: "wispy",
    name: "Wispy",
    aliases: ["wispy", "wispy-cli", "app.wispy", "wispy-website"],
    repoPath: "~/Downloads/wispy",
    oneLine: "Autonomous Gemini agent CLI + platform.",
  },
  {
    slug: "revlog",
    name: "Revlog Africa",
    aliases: ["revlog", "battery", "batteries"],
    repoPath: "~/Downloads/Revlog-website",
    oneLine: "EV battery storage + chain of custody.",
  },
  {
    slug: "tollgate",
    name: "Tollgate",
    aliases: ["tollgate", "402", "x402", "usdc"],
    oneLine: "HTTP 402 bot-economics rail on Arc L1 (Circle Hackathon).",
  },
  {
    slug: "kusini",
    name: "Kusini Labs",
    aliases: ["kusini", "commodity", "traceability"],
    oneLine: "Commodity traceability, blockchain = event hashing.",
  },
  {
    slug: "ktp",
    name: "KTP / Celeri",
    aliases: ["ktp", "celeri", "kenya transport", "investor map"],
    oneLine: "Map-first Kenya transport investor platform, all 47 counties.",
  },
  {
    slug: "paramgolf",
    name: "Parameter Golf",
    aliases: ["paramgolf", "param golf", "openai comp", "bpb"],
    oneLine: "OpenAI 16MB-model BPB competition, $25 budget, top 5 target.",
  },
  {
    slug: "inbox",
    name: "Inbox",
    aliases: ["inbox", "misc", "random", "other"],
    oneLine: "Unrouted / general notes.",
  },
];

export function bySlug(slug: string): Project | undefined {
  return PROJECTS.find((p) => p.slug === slug);
}

export function keywordMatch(text: string): Project | undefined {
  const lower = text.toLowerCase();
  for (const p of PROJECTS) {
    for (const a of p.aliases) {
      if (lower.includes(a.toLowerCase())) return p;
    }
  }
  return undefined;
}
