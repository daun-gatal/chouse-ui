---
app: Admin › Alerting
route: /admin/alerting?view=channels
permissions: alerting:edit
screenshot: admin-alerting-add-channel
---
# Chat apps

A webhook only posts. A **chat app** — a Slack app, a Google Chat app or a Telegram bot — can also **edit** what it posted and carry **buttons** that call back to CHouse: Acknowledge and Snooze on [Data Health](/docs/data-health/) alerts, Approve and Reject on [remediation](/docs/guide-approve-a-fix/) proposals, Approve and Decline on [Need You alerts](/docs/chobi/#need-you-alerts). Every feature that sends alerts can use any channel.

Step by step, with screenshots: [Approve from Slack](/docs/guide-approve-from-chat/).

Set one up in **Admin › Alerting › Channels › Add channel**. Buttons need CHouse reachable from the platform over HTTPS at `PUBLIC_BASE_URL` (Helm `publicBaseUrl`); without it, messages still go out and are still edited, but nobody can press a button.

## Slack

1. Create an app at **api.slack.com/apps › Create New App › From an app manifest**, with this manifest (replace the URL):

   ```yaml
   display_information:
     name: CHouse
   features:
     bot_user:
       display_name: CHouse
   oauth_config:
     scopes:
       bot:
         - chat:write
         - users:read
         - users:read.email
         - usergroups:read
   settings:
     interactivity:
       is_enabled: true
       request_url: https://chouse.example.com/api/integrations/slack/interactions
   ```

2. **Install to Workspace**, then copy the **Bot User OAuth Token** (`xoxb-…`) and, under **Basic Information › App Credentials**, the **Signing Secret**.
3. Invite the bot to the channel (`/invite @CHouse`) and copy the channel ID (channel details › About, `C…`).
4. In CHouse, add a **Slack** channel in **App** mode with the token, the signing secret and the channel ID. **Test** says who the bot is and posts a test message.

`users:read.email` is how CHouse knows who pressed a button; `usergroups:read` is only needed for a user group in the channel's allowlist. The signing secret proves a click came from Slack: a request it does not sign, or one older than five minutes, is refused.

## Google Chat

Chat apps need Google Workspace.

1. In a Google Cloud project, enable the **Google Chat API**.
2. Create a **service account** and a JSON key for it (**Keys › Add key › JSON**).
3. In **Google Chat API › Configuration**: name the app, choose **HTTP endpoint URL** `https://chouse.example.com/api/integrations/google-chat/events`, and set **Authentication audience** to **Project number** (or to the endpoint URL). Make it available to the people or groups who should see it.
4. Add the app to the space, and copy the space from its URL (`spaces/AAAA…`).
5. In CHouse, add a **Google Chat** channel in **App** mode with the key, the space and — if you chose **Project number** — the project number as the audience. With no audience, CHouse expects the endpoint URL.

Google signs every event with its own keys; CHouse checks the signature, the issuer and the audience, and that the event comes from the channel's space.

## Telegram

1. Talk to **@BotFather**, send `/newbot`, and copy the token (`123456789:AA…`).
2. Add the bot to the group, send a message there, and read the chat ID (a negative number such as `-1001234567890`) from `https://api.telegram.org/bot<token>/getUpdates`. Do this before saving the channel: once CHouse registers the bot's webhook, `getUpdates` stops answering.
3. In CHouse, add a **Telegram** channel with the token and the chat ID; for a forum group, add the topic ID. Saving registers the webhook with a secret token Telegram sends back with every update. **Test** shows **Button presses reach CHouse** when that worked.

![Linked chat accounts in Preferences](/docs/img/app/preferences-chat-accounts.jpg "Preferences › Linked chat accounts")

Telegram has no email, so each person links their account once: **Preferences › Linked chat accounts › Link Telegram** opens the bot with a one-time code (it works for ten minutes); pressing **Start** links the account. Codes only work in a private chat with the bot.

## How a button press is checked

1. **The platform** — Slack's signature, Google's signed token, or Telegram's secret token. Anything that does not verify is refused.
2. **The message** — the button must belong to a message CHouse posted to that channel, in that chat or space, and not yet settled.
3. **The person** — Slack: the clicker's confirmed email; Google Chat: the event's email; Telegram: the linked account. It must be an active CHouse user.
4. **The channel's allowlist** — [Who can act from this channel](/docs/alerting/#who-can-act-from-this-channel), when it has one.
5. **The action itself** — CHouse runs it through the same route the UI uses, as that person, with a token that lasts two minutes. So their permissions, connection access and every rule apply: a requester can't approve their own high-risk change, a class-2 fix still needs two people.

The person who clicked gets the answer privately (an ephemeral Slack message, a private Google Chat message, a Telegram pop-up). Each press is audited as `alerting.chat_action` with the platform, the channel and the platform user; links are audited as `chat_identity.link`.

Messages never carry an action's raw arguments: only its description, who asked, where, and when it expires.

## Limits

- Platform calls go only to `slack.com`, `oauth2.googleapis.com`, `chat.googleapis.com`, `www.googleapis.com` and `api.telegram.org`.
- The three callback endpoints accept 300 requests a minute per address, and each person 20 presses a minute.
- Messages are kept for 90 days; older ones are no longer edited.
