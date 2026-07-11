import "dotenv/config";
import pkg from "@slack/bolt";
const { App } = pkg;

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

registerFocusCommand(app);
registerMessageListener(app);

(async () => {
  await initDb();
  await app.start();
  console.log(
    `⚡️ Smart Snooze is running (${SOCKET_MODE ? "socket mode" : `http :${process.env.PORT || 3000}`})`
  );
})();
