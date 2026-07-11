import { getAllActiveSessions, updateSession } from "../db/index.js";
import { evaluateMessage } from "../utils/rules.js";
import { buildBreakThroughCard } from "../blockkit/cards.js";

/**
 * Registers a catch-all message listener. For every incoming message,
 * check it against every active session whose owner could plausibly
 * receive it (i.e. everyone except the sender themself), and either
 * deliver a break-through DM or queue it for that user's digest.
 *
 * Hackathon-scoped: this treats "could plausibly receive it" loosely —
 * for a real deployment you'd filter to sessions for users who are
 * actually members of the channel. Fine for a small workspace demo.
 */
export function registerMessageListener(app) {
  app.event("message", async ({ event, client, logger }) => {
    // Ignore bot messages, message_changed/deleted subtypes, etc.
    if (event.subtype || event.bot_id) return;
    if (!event.user || !event.text) return;

    const activeSessions = await getAllActiveSessions();
    if (activeSessions.length === 0) return;

    for (const session of activeSessions) {
      if (session.userId === event.user) continue; // don't notify yourself

      const { breaksThrough, reason } = await evaluateMessage(session, event);

      if (breaksThrough) {
        await deliverBreakThrough({ session, event, client, reason, logger });
      } else {
        await queueForDigest({ session, event, client, logger });
      }
    }
  });
}

async function deliverBreakThrough({ session, event, client, reason, logger }) {
  try {
    const [senderInfo, channelInfo, permalinkRes] = await Promise.all([
      client.users.info({ user: event.user }).catch(() => null),
      client.conversations.info({ channel: event.channel }).catch(() => null),
      client.chat
        .getPermalink({ channel: event.channel, message_ts: event.ts })
        .catch(() => null)
    ]);

    const senderName = senderInfo?.user?.real_name || senderInfo?.user?.name || event.user;
    const channelName = channelInfo?.channel?.name || event.channel;

    await client.chat.postMessage({
      channel: session.userId,
      text: `🔴 Break-through from ${senderName} in #${channelName}`,
      blocks: buildBreakThroughCard({
        senderName,
        channelName,
        text: event.text,
        reason,
        permalink: permalinkRes?.permalink
      })
    });

    await updateSession(session.id, (s) => {
      s.breakThroughLog.push({
        ts: event.ts,
        senderId: event.user,
        channel: event.channel,
        reason,
        deliveredAt: Date.now()
      });
    });
  } catch (err) {
    logger.error("Failed to deliver break-through DM", err);
  }
}

async function queueForDigest({ session, event, client, logger }) {
  try {
    const [senderInfo, channelInfo] = await Promise.all([
      client.users.info({ user: event.user }).catch(() => null),
      client.conversations.info({ channel: event.channel }).catch(() => null)
    ]);

    let permalink = null;
    try {
      const res = await client.chat.getPermalink({
        channel: event.channel,
        message_ts: event.ts
      });
      permalink = res.permalink;
    } catch {
      // non-fatal, digest just won't have a jump link for this one
    }

    await updateSession(session.id, (s) => {
      s.suppressedMessages.push({
        ts: event.ts,
        senderId: event.user,
        senderName: senderInfo?.user?.real_name || senderInfo?.user?.name || event.user,
        channel: event.channel,
        channelName: channelInfo?.channel?.name || event.channel,
        text: event.text,
        permalink
      });
    });
  } catch (err) {
    logger.error("Failed to queue message for digest", err);
  }
}
