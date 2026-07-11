import { getSession, endSession } from "../db/index.js";
import { buildDigestBlocks } from "../blockkit/cards.js";
import { openDM } from "../utils/slackDm.js";

export async function runDigestForSession(sessionId, client) {
  const session = await getSession(sessionId);
  if (!session) return;

  if (session.status === "active") {
    await endSession(sessionId);
  }

  const dmChannelId = await openDM(client, session.userId);

  await client.chat.postMessage({
    channel: dmChannelId,
    text: "🌙 Your focus session digest is ready.",
    blocks: buildDigestBlocks(session)
  });
}
