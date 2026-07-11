import { classifyUrgency } from "./llmClassifier.js";

/**
 * Tracks recent message timestamps per (sessionId, senderId) in memory,
 * for the frequency-based rule. Good enough for a hackathon demo;
 * swap for a persisted/windowed store if this needs to survive restarts.
 */
const recentMessageLog = new Map(); // key: `${sessionId}:${senderId}` -> [timestamps]

function recordMessageAndCheckFrequency(sessionId, senderId, threshold) {
  if (!threshold || !threshold.count || !threshold.windowMinutes) {
    return false;
  }
  const key = `${sessionId}:${senderId}`;
  const now = Date.now();
  const windowMs = threshold.windowMinutes * 60 * 1000;

  const timestamps = (recentMessageLog.get(key) || []).filter(
    (t) => now - t < windowMs
  );
  timestamps.push(now);
  recentMessageLog.set(key, timestamps);

  return timestamps.length >= threshold.count;
}

function matchesKeyword(text, keywords) {
  if (!text || !keywords?.length) return null;
  const lower = text.toLowerCase();
  return keywords.find((kw) => lower.includes(kw.toLowerCase())) || null;
}

function matchesScope(session, event) {
  switch (session.scope) {
    case "global":
      return true;
    case "channel":
      return event.channel === session.scopeId;
    case "thread":
      // scopeId is the parent thread_ts for thread-scoped snoozes
      return (
        event.channel === session.scopeChannelId &&
        (event.thread_ts === session.scopeId || event.ts === session.scopeId)
      );
    default:
      return true;
  }
}

/**
 * Evaluates a single incoming message/mention event against a session's
 * break-through ruleset. Returns { breaksThrough, reason } synchronously
 * for the hard rules (sender/keyword/frequency), and only awaits the LLM
 * classifier when nothing else matched and it's enabled.
 */
export async function evaluateMessage(session, event) {
  const { user: senderId, text, channel } = event;

  // Snooze is scoped elsewhere (e.g. "everything except #incidents") —
  // if this message isn't in scope, don't even apply break-through rules;
  // it's suppressed by definition of the scope.
  if (!matchesScope(session, event)) {
    return { breaksThrough: false, reason: "out_of_scope" };
  }

  const rules = session.breakThroughRules || {};

  // 1. Sender allowlist — fastest, cheapest check first
  if (rules.allowedSenders?.includes(senderId)) {
    return { breaksThrough: true, reason: `allowed_sender:${senderId}` };
  }

  // 2. Keyword/phrase match
  const keywordHit = matchesKeyword(text, rules.keywords);
  if (keywordHit) {
    return { breaksThrough: true, reason: `keyword:${keywordHit}` };
  }

  // 3. Frequency-based escalation
  if (
    recordMessageAndCheckFrequency(session.id, senderId, rules.frequencyThreshold)
  ) {
    return {
      breaksThrough: true,
      reason: `frequency:${rules.frequencyThreshold.count}x in ${rules.frequencyThreshold.windowMinutes}m`
    };
  }

  // 4. LLM urgency classifier — last resort, only if enabled for this session
  if (rules.useLLMClassifier) {
    const { urgent, rationale } = await classifyUrgency({ text, channel });
    if (urgent) {
      return { breaksThrough: true, reason: `llm_urgent:${rationale}` };
    }
  }

  return { breaksThrough: false, reason: "no_rule_matched" };
}
