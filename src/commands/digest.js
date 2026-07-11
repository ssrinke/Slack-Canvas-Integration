import { getSession, endSession } from "../db/index.js";
import { buildDigestBlocks } from "../blockkit/cards.js";

export async function runDigestForSession(sessionId, client) {
  const session = await getSession(sessionId);
  if (!session) return;

  if (session.status === "active") {
    await endSession(sessionId);
  }

  await client.chat.postMessage({
    channel: session.userId,
    text: "🌙 Your focus session digest is ready.",
    blocks: buildDigestBlocks(session)
  });
}
