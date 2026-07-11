import "dotenv/config";
import pkg from "@slack/bolt";
const { App } = pkg;
import { WebClient } from "@slack/web-api";

import { initDb } from "./db/index.js";
import { registerFocusCommand } from "./commands/focus.js";
import { registerMessageListener } from "./listeners/messageListener.js";

const SOCKET_MODE = process.env.SOCKET_MODE === "true";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: SOCKET_MODE,
  appToken: SOCKET_MODE ? process.env.SLACK_APP_TOKEN : undefined,
  port: process.env.PORT || 3000
});

// dnd.setSnooze / dnd.endSnooze only work with a USER token (dnd:write is a
// user-scoped permission) -- the bot token below is for everything else
// (posting messages, listening to events).
if (!process.env.SLACK_USER_TOKEN) {
  console.warn(
    "⚠️  SLACK_USER_TOKEN not set -- native dnd.setSnooze/endSnooze calls will fail. " +
      "See .env.example: dnd:write/dnd:read are user token scopes, not bot scopes."
  );
}
const userClient = new WebClient(process.env.SLACK_USER_TOKEN);

registerFocusCommand(app, userClient);
registerMessageListener(app);

(async () => {
  await initDb();
  await app.start();
  console.log(
    `⚡️ Smart Snooze is running (${SOCKET_MODE ? "socket mode" : `http :${process.env.PORT || 3000}`})`
  );
})();
