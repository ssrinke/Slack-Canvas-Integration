import { nanoid } from "nanoid";
import {
  buildFocusModal,
  parseFocusModalSubmission,
  FOCUS_MODAL_CALLBACK_ID
} from "../blockkit/focusModal.js";
import { createSession, getActiveSessionForUser, endSession } from "../db/index.js";
import { runDigestForSession } from "./digest.js";
import { openDM } from "../utils/slackDm.js";

// Hackathon-scoped: hard-coded fallback allowlist if the user hasn't
// configured one elsewhere yet. Swap for a per-user settings lookup later.
const DEFAULT_ALLOWED_SENDERS = (process.env.DEFAULT_ALLOWED_SENDERS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function registerFocusCommand(app, userClient) {
  app.command("/focus", async ({ ack, body, client, logger }) => {
    await ack();

    const existing = await getActiveSessionForUser(body.user_id);
    if (existing) {
      try {
        await client.chat.postEphemeral({
          channel: body.channel_id,
          user: body.user_id,
          text: `You're already in focus mode until <!date^${Math.floor(
            existing.endTime / 1000
          )}^{time}|later today>. Use \`/unfocus\` to end it early.`
        });
      } catch (err) {
        logger.error("Failed to post ephemeral 'already in focus' notice", err);
      }
      return;
    }

    try {
      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildFocusModal()
      });
    } catch (err) {
      logger.error("Failed to open /focus modal", err);
    }
  });

  app.view(FOCUS_MODAL_CALLBACK_ID, async ({ ack, body, view, client, logger }) => {
    await ack();

    const userId = body.user.id;
    const { durationMinutes, scope, breakThroughRules } = parseFocusModalSubmission(
      view.state.values,
      { defaultAllowedSenders: DEFAULT_ALLOWED_SENDERS }
    );

    const scopeId = scope === "channel" ? body.view.private_metadata || null : null;
    const startTime = Date.now();
    const endTime = startTime + durationMinutes * 60 * 1000;

    // 1. Set native Slack DND as the baseline — this is what stops mobile
    //    push / desktop notifications for anything we don't explicitly
    //    break through ourselves. dnd.setSnooze is a USER-token method
    //    (dnd:write is a user scope, not a bot scope), so this has to go
    //    through userClient, not the bot's client.
    try {
      await userClient.dnd.setSnooze({ num_minutes: durationMinutes });
    } catch (err) {
      logger.error("dnd.setSnooze failed", err);
      // Non-fatal: our own layer still works for break-through delivery,
      // it just means native notifications for non-matching messages
      // won't be silenced by Slack itself. Worth surfacing to the user.
      try {
        const dmChannelId = await openDM(client, userId);
        await client.chat.postMessage({
          channel: dmChannelId,
          text: "⚠️ Couldn't set native Slack DND (check SLACK_USER_TOKEN has `dnd:write`), but focus mode is still tracking break-through rules."
        });
      } catch (dmErr) {
        logger.error("Also failed to DM the dnd.setSnooze warning", dmErr);
      }
    }

    // 2. Store the break-through ruleset for this session.
    const session = {
      id: nanoid(),
      userId,
      startTime,
      endTime,
      scope,
      scopeId,
      status: "active",
      breakThroughRules,
      suppressedMessages: [],
      breakThroughLog: []
    };
    await createSession(session);

    try {
      const dmChannelId = await openDM(client, userId);
      await client.chat.postMessage({
        channel: dmChannelId,
        text: `🎯 Focus mode on for ${durationMinutes} min. ${summarizeRules(breakThroughRules)}`
      });
    } catch (err) {
      logger.error("Failed to send focus-mode confirmation DM", err);
    }

    // Schedule automatic end + digest. Fine for a hackathon demo;
    // for production swap this for a durable scheduler (e.g. a cron
    // sweep over getAllActiveSessions()) since setTimeout won't
    // survive a process restart.
    setTimeout(() => {
      runDigestForSession(session.id, client).catch((err) =>
        logger.error("Digest generation failed", err)
      );
    }, durationMinutes * 60 * 1000);
  });

  app.command("/unfocus", async ({ ack, body, client, logger }) => {
    await ack();
    const session = await getActiveSessionForUser(body.user_id);
    if (!session) {
      try {
        await client.chat.postEphemeral({
          channel: body.channel_id,
          user: body.user_id,
          text: "You're not in focus mode right now."
        });
      } catch (err) {
        logger.error("Failed to post ephemeral 'not in focus' notice", err);
      }
      return;
    }

    try {
      await userClient.dnd.endSnooze();
    } catch (err) {
      logger.warn("dnd.endSnooze failed (may have already lapsed)", err);
    }

    await endSession(session.id);
    await runDigestForSession(session.id, client);
  });
}

function summarizeRules(rules) {
  const parts = [];
  if (rules.allowedSenders?.length) parts.push(`${rules.allowedSenders.length} allowlisted sender(s)`);
  if (rules.keywords?.length) parts.push(`keywords: ${rules.keywords.join(", ")}`);
  if (rules.frequencyThreshold) {
    parts.push(
      `${rules.frequencyThreshold.count}x in ${rules.frequencyThreshold.windowMinutes}min escalation`
    );
  }
  if (rules.useLLMClassifier) parts.push("AI urgency check");
  return parts.length ? `Breaking through: ${parts.join(" · ")}.` : "No break-through rules set — everything's queued for your digest.";
}
