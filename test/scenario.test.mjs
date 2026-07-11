import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDbPath = path.join(__dirname, "..", "db.json");

// Use a scratch db.json for this test run, and clean it up after.
before(async () => {
  await unlink(testDbPath).catch(() => {}); // start clean
});
after(async () => {
  await unlink(testDbPath).catch(() => {});
});

const { initDb, createSession, getSession } = await import("../src/db/index.js");
const { processMessageEvent } = await import("../src/listeners/messageListener.js");
const { runDigestForSession } = await import("../src/commands/digest.js");
const { createMockSlackClient } = await import("./mockSlackClient.js");

await initDb();

test("full mock scenario: mixed messages produce correct break-throughs and digest", async () => {
  const client = createMockSlackClient({
    users: {
      U_MANAGER: { id: "U_MANAGER", real_name: "Priya Manager" },
      U_TEAMMATE: { id: "U_TEAMMATE", real_name: "Jordan Teammate" },
      U_RANDOM: { id: "U_RANDOM", real_name: "Random Person" }
    },
    channels: {
      C_GENERAL: { id: "C_GENERAL", name: "general" },
      C_INCIDENTS: { id: "C_INCIDENTS", name: "incidents" }
    }
  });

  const session = await createSession({
    id: "sess_scenario_1",
    userId: "U_OWNER",
    startTime: Date.now(),
    endTime: Date.now() + 30 * 60 * 1000,
    scope: "global",
    scopeId: null,
    status: "active",
    breakThroughRules: {
      allowedSenders: ["U_MANAGER"],
      keywords: ["prod down", "incident"],
      frequencyThreshold: { count: 2, windowMinutes: 5 },
      useLLMClassifier: false
    },
    suppressedMessages: [],
    breakThroughLog: []
  });

  // Scripted "conversation" while the owner is snoozed. Field names match
  // Slack's real message event shape: `user`, not `userId`.
  const script = [
    // 1. Manager pings something totally mundane -> should still break through (allowlist)
    { user: "U_MANAGER", channel: "C_GENERAL", text: "can you review my PR when you're back?", ts: "1.001" },
    // 2. Random person, unrelated chatter -> queued
    { user: "U_RANDOM", channel: "C_GENERAL", text: "anyone want coffee?", ts: "1.002" },
    // 3. Random person, keyword match -> breaks through
    { user: "U_RANDOM", channel: "C_INCIDENTS", text: "prod down, need eyes now", ts: "1.003" },
    // 4. Teammate pings once -> queued (not yet at frequency threshold)
    { user: "U_TEAMMATE", channel: "C_GENERAL", text: "hey", ts: "1.004" },
    // 5. Teammate pings again within window -> breaks through on frequency
    { user: "U_TEAMMATE", channel: "C_GENERAL", text: "hey, you there?", ts: "1.005" },
    // 6. Owner's own message -> ignored entirely
    { user: "U_OWNER", channel: "C_GENERAL", text: "brb", ts: "1.006" }
  ];

  for (const event of script) {
    await processMessageEvent({ event, client, logger: { error: () => {}, warn: () => {} } });
  }

  // --- Assertions on break-through delivery ---
  const breakThroughTexts = client.calls.postMessage.map((m) => m.blocks?.[1]?.text?.text);
  assert.equal(client.calls.postMessage.length, 3, "expected exactly 3 break-through DMs");
  assert.ok(breakThroughTexts.some((t) => t?.includes("review my PR")), "manager message should break through");
  assert.ok(breakThroughTexts.some((t) => t?.includes("prod down")), "keyword message should break through");
  assert.ok(breakThroughTexts.some((t) => t?.includes("you there")), "second teammate ping should break through on frequency");

  // --- Assertions on digest contents ---
  const updatedSession = await getSession(session.id);
  assert.equal(updatedSession.suppressedMessages.length, 2, "expected 2 queued (non-break-through) messages");
  const queuedTexts = updatedSession.suppressedMessages.map((m) => m.text);
  assert.ok(queuedTexts.includes("anyone want coffee?"));
  assert.ok(queuedTexts.includes("hey"));

  // Owner's own message should never appear anywhere
  assert.ok(!breakThroughTexts.some((t) => t?.includes("brb")));
  assert.ok(!queuedTexts.includes("brb"));

  // --- Run the actual digest generator and inspect the resulting Block Kit payload ---
  client.calls.postMessage.length = 0; // reset to isolate the digest call
  await runDigestForSession(session.id, client);

  assert.equal(client.calls.postMessage.length, 1, "digest should be a single message");
  const digestPayload = client.calls.postMessage[0];
  assert.equal(digestPayload.channel, "D_U_OWNER");
  const digestText = JSON.stringify(digestPayload.blocks);
  assert.match(digestText, /general/); // channel grouping present
  assert.match(digestText, /coffee/);
  assert.match(digestText, /hey/);

  console.log("\n--- Scenario summary ---");
  console.log(`Break-throughs delivered: ${3}`);
  console.log(`Messages queued to digest: ${updatedSession.suppressedMessages.length}`);
  console.log("Digest card built successfully with channel grouping.\n");
});

