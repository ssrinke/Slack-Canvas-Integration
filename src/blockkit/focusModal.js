export const FOCUS_MODAL_CALLBACK_ID = "focus_modal_submit";

/**
 * Presets checklist — maps straight onto breakThroughRules in the doc's
 * data model. "Manager only" / "Keywords" / "Anyone messaging twice" are
 * the three sensible defaults called out in the spec.
 */
export function buildFocusModal({ channelOptions = [] } = {}) {
  return {
    type: "modal",
    callback_id: FOCUS_MODAL_CALLBACK_ID,
    title: { type: "plain_text", text: "Focus mode" },
    submit: { type: "plain_text", text: "Start" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "duration_block",
        label: { type: "plain_text", text: "Duration" },
        element: {
          type: "static_select",
          action_id: "duration_select",
          placeholder: { type: "plain_text", text: "How long?" },
          options: [
            { text: { type: "plain_text", text: "30 minutes" }, value: "30" },
            { text: { type: "plain_text", text: "1 hour" }, value: "60" },
            { text: { type: "plain_text", text: "2 hours" }, value: "120" },
            { text: { type: "plain_text", text: "4 hours" }, value: "240" },
            { text: { type: "plain_text", text: "Rest of day" }, value: "eod" }
          ]
        }
      },
      {
        type: "input",
        block_id: "scope_block",
        label: { type: "plain_text", text: "Scope" },
        element: {
          type: "static_select",
          action_id: "scope_select",
          placeholder: { type: "plain_text", text: "What gets snoozed?" },
          options: [
            {
              text: { type: "plain_text", text: "Everywhere" },
              value: "global"
            },
            {
              text: { type: "plain_text", text: "This channel only" },
              value: "channel"
            }
          ]
        }
      },
      {
        type: "input",
        block_id: "rules_block",
        label: { type: "plain_text", text: "Let these through" },
        element: {
          type: "checkboxes",
          action_id: "rules_checkboxes",
          options: [
            {
              text: { type: "plain_text", text: "Manager / on-call only" },
              value: "manager_only",
              description: {
                type: "plain_text",
                text: "Uses your configured allowlist"
              }
            },
            {
              text: {
                type: "plain_text",
                text: "Keywords: incident, blocked, prod, urgent"
              },
              value: "default_keywords"
            },
            {
              text: {
                type: "plain_text",
                text: "Anyone messaging twice in 5 min"
              },
              value: "frequency_2_5"
            },
            {
              text: { type: "plain_text", text: "AI urgency check (beta)" },
              value: "llm_classifier"
            }
          ]
        },
        optional: true
      },
      {
        type: "input",
        block_id: "custom_keywords_block",
        label: { type: "plain_text", text: "Extra keywords (comma-separated)" },
        element: {
          type: "plain_text_input",
          action_id: "custom_keywords_input",
          placeholder: { type: "plain_text", text: "e.g. outage, sev1, escalation" }
        },
        optional: true
      }
    ]
  };
}

/**
 * Parses the modal's view_submission state_values into the
 * breakThroughRules shape used by the db layer.
 */
export function parseFocusModalSubmission(stateValues, { defaultAllowedSenders = [] } = {}) {
  const durationRaw = stateValues.duration_block.duration_select.selected_option.value;
  const scope = stateValues.scope_block.scope_select.selected_option.value;
  const selectedRules = (
    stateValues.rules_block.rules_checkboxes.selected_options || []
  ).map((o) => o.value);
  const customKeywordsRaw =
    stateValues.custom_keywords_block.custom_keywords_input.value || "";

  const keywords = [
    ...(selectedRules.includes("default_keywords")
      ? ["incident", "blocked", "prod", "urgent", "prod down"]
      : []),
    ...customKeywordsRaw
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean)
  ];

  const breakThroughRules = {
    allowedSenders: selectedRules.includes("manager_only")
      ? defaultAllowedSenders
      : [],
    keywords,
    frequencyThreshold: selectedRules.includes("frequency_2_5")
      ? { count: 2, windowMinutes: 5 }
      : null,
    useLLMClassifier: selectedRules.includes("llm_classifier")
  };

  const durationMinutes = durationRaw === "eod" ? minutesUntilEndOfDay() : Number(durationRaw);

  return { durationMinutes, scope, breakThroughRules };
}

function minutesUntilEndOfDay() {
  const now = new Date();
  const eod = new Date(now);
  eod.setHours(23, 59, 0, 0);
  return Math.max(30, Math.round((eod - now) / 60000));
}
