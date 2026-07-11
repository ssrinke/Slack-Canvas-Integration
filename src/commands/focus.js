import { nanoid } from "nanoid";
import {
  buildFocusModal,
  parseFocusModalSubmission,
  FOCUS_MODAL_CALLBACK_ID
} from "../blockkit/focusModal.js";
import { createSession, getActiveSessionForUser, endSession } from "../db/index.js";
import { runDigestForSession } from "./digest.js";

// Hackathon-scoped: hard-coded fallback allowlist if the user hasn't
// configured one elsewhere yet. Swap for a per-user settings lookup later.
const DEFAULT_ALLOWED_SENDERS = (process.env.DEFAULT_ALLOWED_SENDERS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function registerFocusCommand(app) {
  app.command("/focus", async ({ ack, body, client, logger }) => {
    await ack();

    const existing = await getActiveSessionForUser(body.user_id);
    if (existing) {
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: `You're already in focus mode until <!date^${Math.floor(
          existing.endTime / 1000
        )}^{time}|later today>. Use \`/unfocus\` to end it early.`
      });
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
    //    break through ourselves.
    try {
      await client.dnd.setSnooze({ num_minutes: durationMinutes });
    } catch (err) {
      logger.error("dnd.setSnooze failed", err);
      // Non-fatal: our own layer still works for break-through delivery,
      // it just means native notifications for non-matching messages
      // won't be silenced by Slack itself. Worth surfacing to the user.
      await client.chat.postMessage({
        channel: userId,
        text: "⚠️ Couldn't set native Slack DND (missing `dnd:write` scope?), but focus mode is still tracking break-through rules."
      });
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

    await client.chat.postMessage({
      channel: userId,
      text: `🎯 Focus mode on for ${durationMinutes} min. ${summarizeRules(breakThroughRules)}`
    });

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
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: "You're not in focus mode right now."
      });
      return;
    }

    try {
      await client.dnd.endSnooze();
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
