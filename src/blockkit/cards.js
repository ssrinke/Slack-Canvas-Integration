/**
 * Sent as a bot DM the instant a message breaks through the ruleset.
 * Shows *why* it got through, so the filter feels trustworthy rather
 * than random, per the spec's "in-progress indicator" requirement.
 */
export function buildBreakThroughCard({ senderName, channelName, text, reason, permalink }) {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🔴 *Break-through* — from *${senderName}* in *#${channelName}*\n_why: ${humanizeReason(reason)}_`
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: text?.length > 300 ? text.slice(0, 300) + "…" : text || "_(no text)_"
      }
    },
    permalink && {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Jump to thread" },
          url: permalink,
          action_id: "jump_to_thread"
        }
      ]
    }
  ].filter(Boolean);
}

/**
 * End-of-session digest card: suppressed messages grouped by channel,
 * with a jump-to-thread button per item, per the spec.
 */
export function buildDigestBlocks(session) {
  const grouped = groupByChannel(session.suppressedMessages || []);
  const channelNames = Object.keys(grouped);

  if (channelNames.length === 0) {
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `🌙 *Focus session ended.* Nothing piled up while you were away — inbox zero!`
        }
      }
    ];
  }

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🌙 *Focus session ended.* Here's what was quietly waiting for you, grouped by channel:`
      }
    },
    { type: "divider" }
  ];

  for (const channelName of channelNames) {
    const messages = grouped[channelName];
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*#${channelName}* — ${messages.length} message${messages.length === 1 ? "" : "s"}` }
    });

    for (const msg of messages.slice(0, 5)) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `• *${msg.senderName}*: ${truncate(msg.text, 120)}`
        },
        accessory: msg.permalink
          ? {
              type: "button",
              text: { type: "plain_text", text: "Jump" },
              url: msg.permalink,
              action_id: "jump_to_thread"
            }
          : undefined
      });
    }

    if (messages.length > 5) {
      blocks.push({
        type: "context",
        elements: [
          { type: "mrkdwn", text: `…and ${messages.length - 5} more in #${channelName}` }
        ]
      });
    }
    blocks.push({ type: "divider" });
  }

  return blocks;
}

function groupByChannel(messages) {
  return messages.reduce((acc, m) => {
    (acc[m.channelName] ||= []).push(m);
    return acc;
  }, {});
}

function truncate(text, n) {
  if (!text) return "_(no text)_";
  return text.length > n ? text.slice(0, n) + "…" : text;
}

function humanizeReason(reason = "") {
  if (reason.startsWith("allowed_sender")) return "sender is on your allowlist";
  if (reason.startsWith("keyword")) return `matched keyword "${reason.split(":")[1]}"`;
  if (reason.startsWith("frequency")) return `same sender pinged you repeatedly (${reason.split(":")[1]})`;
  if (reason.startsWith("llm_urgent")) return `AI flagged this as urgent (${reason.split(":")[1]})`;
  return reason;
}
