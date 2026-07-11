/**
 * Passing a raw user ID directly as `channel` to chat.postMessage can
 * intermittently fail with channel_not_found instead of auto-opening a DM
 * (depends on whether a conversation already exists with that user).
 * conversations.open is the reliable way to get a DM channel ID first.
 */
export async function openDM(client, userId) {
  const res = await client.conversations.open({ users: userId });
  if (!res.ok || !res.channel?.id) {
    throw new Error(`Failed to open DM with ${userId}: ${res.error || "unknown error"}`);
  }
  return res.channel.id;
}
