import { IMessageSDK } from "@photon-ai/imessage-kit";
import { tryCommand } from "./commands.ts";
import { route } from "./router.ts";
import { appendNote, newId, type Note } from "./storage.ts";
import { buildStandup } from "./standup.ts";

const OWNER = process.env.OWNER_HANDLE?.trim();
if (!OWNER) {
  console.error("set OWNER_HANDLE in .env (phone/email of your own iMessage)");
  process.exit(1);
}

function normalize(h: string): string {
  return h.replace(/[\s\-\(\)]/g, "").toLowerCase();
}

const OWNER_NORM = normalize(OWNER);

async function reply(sdk: IMessageSDK, to: string, text: string): Promise<void> {
  try {
    await sdk.send({ to, text });
  } catch (e) {
    console.error("send failed:", e);
  }
}

async function handle(sdk: IMessageSDK, msg: { text?: string; sender?: string; chatId?: string }) {
  const text = msg.text?.trim();
  const sender = msg.sender ? normalize(msg.sender) : "";
  if (!text || !msg.chatId) return;
  if (sender !== OWNER_NORM) return;

  const cmd = await tryCommand(text);
  if (cmd.handled) {
    await reply(sdk, msg.chatId, cmd.text);
    return;
  }

  const r = await route(text);
  const note: Note = {
    id: newId(),
    ts: Date.now(),
    kind: r.kind,
    text: r.summary,
    source: "imessage",
  };
  await appendNote(r.project.slug, note);

  const tag = r.kind === "note" ? "" : ` [${r.kind}]`;
  const conf = r.confidence < 0.5 ? " ?" : "";
  await reply(sdk, msg.chatId, `→ ${r.project.name}${tag}${conf} · ${note.id}`);
}

function parseHHMM(s: string): { h: number; m: number } | null {
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return { h: Number(m[1]), m: Number(m[2]) };
}

function scheduleStandup(sdk: IMessageSDK): void {
  const at = process.env.STANDUP_AT?.trim();
  if (!at) return;
  const t = parseHHMM(at);
  if (!t) {
    console.warn(`STANDUP_AT malformed: ${at}`);
    return;
  }
  const tick = async () => {
    const now = new Date();
    if (now.getHours() === t.h && now.getMinutes() === t.m) {
      const digest = await buildStandup();
      await reply(sdk, OWNER, digest);
    }
  };
  setInterval(tick, 60_000);
  console.log(`⏰ standup scheduled ${at}`);
}

async function main() {
  const sdk = new IMessageSDK();
  await sdk.startWatching({
    onDirectMessage: (m) => handle(sdk, m).catch((e) => console.error("handle:", e)),
    onError: (e) => console.error("watcher:", e),
  });
  scheduleStandup(sdk);
  console.log(`👷 foreman running · owner=${OWNER}`);

  const stop = async () => {
    console.log("\nstopping…");
    await sdk.stopWatching();
    await sdk.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
