import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateMessage } from "../src/utils/rules.js";

function baseSession(overrides = {}) {
  return {
    id: "sess_test_" + Math.random().toString(36).slice(2),
    userId: "U_OWNER",
    scope: "global",
    scopeId: null,
    breakThroughRules: {
      allowedSenders: [],
      keywords: [],
      frequencyThreshold: null,
      useLLMClassifier: false
    },
    ...overrides
  };
}

test("sender allowlist breaks through", async () => {
  const session = baseSession({
    breakThroughRules: {
      allowedSenders: ["U_MANAGER"],
      keywords: [],
      frequencyThreshold: null,
      useLLMClassifier: false
    }
  });
  const result = await evaluateMessage(session, {
    user: "U_MANAGER",
    text: "hey, got a sec?",
    channel: "C_GENERAL"
  });
  assert.equal(result.breaksThrough, true);
  assert.match(result.reason, /allowed_sender/);
});

test("non-allowlisted sender does not break through on identity alone", async () => {
  const session = baseSession({
    breakThroughRules: {
      allowedSenders: ["U_MANAGER"],
      keywords: [],
      frequencyThreshold: null,
      useLLMClassifier: false
    }
  });
  const result = await evaluateMessage(session, {
    user: "U_RANDOM",
    text: "hey, got a sec?",
    channel: "C_GENERAL"
  });
  assert.equal(result.breaksThrough, false);
});

test("keyword match breaks through", async () => {
  const session = baseSession({
    breakThroughRules: {
      allowedSenders: [],
      keywords: ["prod down", "incident"],
      frequencyThreshold: null,
      useLLMClassifier: false
    }
  });
  const result = await evaluateMessage(session, {
    user: "U_RANDOM",
    text: "heads up, prod down in us-east",
    channel: "C_GENERAL"
  });
  assert.equal(result.breaksThrough, true);
  assert.match(result.reason, /keyword:prod down/);
});

test("keyword match is case-insensitive", async () => {
  const session = baseSession({
    breakThroughRules: {
      allowedSenders: [],
      keywords: ["urgent"],
      frequencyThreshold: null,
      useLLMClassifier: false
    }
  });
  const result = await evaluateMessage(session, {
    user: "U_RANDOM",
    text: "This is URGENT please read",
    channel: "C_GENERAL"
  });
  assert.equal(result.breaksThrough, true);
});

test("unrelated message with no rule match is queued, not delivered", async () => {
  const session = baseSession({
    breakThroughRules: {
      allowedSenders: [],
      keywords: ["incident"],
      frequencyThreshold: null,
      useLLMClassifier: false
    }
  });
  const result = await evaluateMessage(session, {
    user: "U_RANDOM",
    text: "anyone up for lunch?",
    channel: "C_GENERAL"
  });
  assert.equal(result.breaksThrough, false);
  assert.equal(result.reason, "no_rule_matched");
});

test("frequency rule: first message does not break through", async () => {
  const session = baseSession({
    id: "sess_freq_1",
    breakThroughRules: {
      allowedSenders: [],
      keywords: [],
      frequencyThreshold: { count: 2, windowMinutes: 5 },
      useLLMClassifier: false
    }
  });
  const result = await evaluateMessage(session, {
    user: "U_CHATTY",
    text: "yo",
    channel: "C_GENERAL"
  });
  assert.equal(result.breaksThrough, false);
});

test("frequency rule: second message within window breaks through", async () => {
  const session = baseSession({
    id: "sess_freq_2",
    breakThroughRules: {
      allowedSenders: [],
      keywords: [],
      frequencyThreshold: { count: 2, windowMinutes: 5 },
      useLLMClassifier: false
    }
  });
  const event = { user: "U_CHATTY", text: "yo", channel: "C_GENERAL" };
  const first = await evaluateMessage(session, event);
  const second = await evaluateMessage(session, event);
  assert.equal(first.breaksThrough, false);
  assert.equal(second.breaksThrough, true);
  assert.match(second.reason, /frequency/);
});

test("channel scope: message outside scoped channel does not break through even on keyword match", async () => {
  const session = baseSession({
    scope: "channel",
    scopeId: "C_INCIDENTS",
    breakThroughRules: {
      allowedSenders: [],
      keywords: ["incident"],
      frequencyThreshold: null,
      useLLMClassifier: false
    }
  });
  const result = await evaluateMessage(session, {
    user: "U_RANDOM",
    text: "incident update",
    channel: "C_RANDOM_CHANNEL"
  });
  assert.equal(result.breaksThrough, false);
  assert.equal(result.reason, "out_of_scope");
});

test("channel scope: message inside scoped channel with keyword match breaks through", async () => {
  const session = baseSession({
    scope: "channel",
    scopeId: "C_INCIDENTS",
    breakThroughRules: {
      allowedSenders: [],
      keywords: ["incident"],
      frequencyThreshold: null,
      useLLMClassifier: false
    }
  });
  const result = await evaluateMessage(session, {
    user: "U_RANDOM",
    text: "incident update",
    channel: "C_INCIDENTS"
  });
  assert.equal(result.breaksThrough, true);
});

test("LLM classifier disabled (default): never breaks through on content alone", async () => {
  const session = baseSession({
    breakThroughRules: {
      allowedSenders: [],
      keywords: [],
      frequencyThreshold: null,
      useLLMClassifier: true // enabled in session, but ENABLE_LLM_CLASSIFIER env is unset
    }
  });
  const result = await evaluateMessage(session, {
    user: "U_RANDOM",
    text: "everything is on fire please help immediately",
    channel: "C_GENERAL"
  });
  // classifyUrgency fails safe to false when ENABLE_LLM_CLASSIFIER isn't "true"
  assert.equal(result.breaksThrough, false);
  assert.equal(result.reason, "no_rule_matched");
});
