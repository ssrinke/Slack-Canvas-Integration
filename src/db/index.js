import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbFile = path.join(__dirname, "..", "..", "db.json");

const defaultData = {
  // one row per active/past focus session, keyed by session id
  smartSnoozeSessions: {}
};

const adapter = new JSONFile(dbFile);
export const db = new Low(adapter, defaultData);

export async function initDb() {
  await db.read();
  db.data ||= defaultData;
  await db.write();
  return db;
}

/**
 * Session shape (matches the spec doc):
 * {
 *   id,
 *   userId,
 *   startTime, endTime,
 *   scope: "global" | "channel" | "thread",
 *   scopeId,
 *   status: "active" | "ended",
 *   breakThroughRules: {
 *     allowedSenders: [...],
 *     keywords: [...],
 *     frequencyThreshold: { count, windowMinutes },
 *     useLLMClassifier: bool
 *   },
 *   suppressedMessages: [...],
 *   breakThroughLog: [...]   // messages that broke through, for transparency/debug
 * }
 */

export async function createSession(session) {
  await db.read();
  db.data.smartSnoozeSessions[session.id] = session;
  await db.write();
  return session;
}

export async function getActiveSessionForUser(userId) {
  await db.read();
  const sessions = Object.values(db.data.smartSnoozeSessions);
  const now = Date.now();
  return sessions.find(
    (s) => s.userId === userId && s.status === "active" && s.endTime > now
  );
}

export async function getSession(sessionId) {
  await db.read();
  return db.data.smartSnoozeSessions[sessionId];
}

export async function updateSession(sessionId, updater) {
  await db.read();
  const session = db.data.smartSnoozeSessions[sessionId];
  if (!session) return null;
  updater(session);
  await db.write();
  return session;
}

export async function endSession(sessionId) {
  return updateSession(sessionId, (s) => {
    s.status = "ended";
  });
}

export async function getAllActiveSessions() {
  await db.read();
  const now = Date.now();
  return Object.values(db.data.smartSnoozeSessions).filter(
    (s) => s.status === "active" && s.endTime > now
  );
}
