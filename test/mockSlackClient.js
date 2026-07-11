/**
 * A fake @slack/web-api client that records every call instead of hitting
 * Slack's servers. Enough surface area to exercise messageListener.js and
 * commands/focus.js end to end offline.
 */
export function createMockSlackClient({ users = {}, channels = {} } = {}) {
  const calls = {
    postMessage: [],
    postEphemeral: [],
    getPermalink: []
  };

  const client = {
    calls,
    chat: {
      postMessage: async (args) => {
        calls.postMessage.push(args);
        return { ok: true, ts: `${Date.now() / 1000}` };
      },
      postEphemeral: async (args) => {
        calls.postEphemeral.push(args);
        return { ok: true };
      },
      getPermalink: async ({ channel, message_ts }) => {
        calls.getPermalink.push({ channel, message_ts });
        return { ok: true, permalink: `https://mock.slack.com/archives/${channel}/p${message_ts}` };
      }
    },
    users: {
      info: async ({ user }) => ({
        ok: true,
        user: users[user] || { id: user, name: user, real_name: user }
      })
    },
    conversations: {
      info: async ({ channel }) => ({
        ok: true,
        channel: channels[channel] || { id: channel, name: channel }
      }),
      open: async ({ users }) => ({
        ok: true,
        channel: { id: `D_${users}` }
      })
    },
    views: {
      open: async () => ({ ok: true })
    },
    dnd: {
      setSnooze: async () => ({ ok: true, snooze_enabled: true }),
      endSnooze: async () => ({ ok: true, dnd_enabled: false })
    }
  };

  return client;
}
