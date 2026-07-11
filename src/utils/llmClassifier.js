import "dotenv/config";

const ENABLED = process.env.ENABLE_LLM_CLASSIFIER === "true";
const API_KEY = process.env.ANTHROPIC_API_KEY;

/**
 * Classifies a single message (with light thread context) as urgent or not.
 * Kept intentionally dumb/cheap: one small model call, no streaming, no
 * per-message chaining. In build order this is step 4 — last layer, good
 * demo moment, not load-bearing for MVP. If disabled or no key, fail safe
 * to "not urgent" (message goes to the digest, nothing gets lost, it's
 * just not surfaced immediately).
 */
export async function classifyUrgency({ text, channel, threadContext = "" }) {
  if (!ENABLED || !API_KEY || !text) {
    return { urgent: false, rationale: "classifier_disabled" };
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 60,
        system:
          "You triage Slack messages for someone in do-not-disturb mode. " +
          "Decide if THIS message is urgent enough to interrupt them right now, " +
          "as opposed to waiting in a digest for later. Respond with strict JSON only: " +
          '{"urgent": boolean, "rationale": "<=8 words"}',
        messages: [
          {
            role: "user",
            content: `Channel: ${channel}\nThread context: ${threadContext || "(none)"}\nMessage: ${text}`
          }
        ]
      })
    });

    if (!res.ok) {
      return { urgent: false, rationale: `classifier_error_${res.status}` };
    }

    const data = await res.json();
    const raw = data.content?.find((b) => b.type === "text")?.text?.trim() || "{}";
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return {
      urgent: Boolean(parsed.urgent),
      rationale: parsed.rationale || "llm_classified"
    };
  } catch (err) {
    // Fail safe: never let a classifier hiccup crash message delivery.
    return { urgent: false, rationale: "classifier_exception" };
  }
}
