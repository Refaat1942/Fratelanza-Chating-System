# Facebook Messenger & Instagram Direct setup

The code is ready; each channel turns on as soon as its token is in
`deploy/.env` and the webhook is subscribed. Nothing about WhatsApp changes.

## What the server does

- `GET /api/webhooks/messenger` and `/api/webhooks/instagram` answer Meta's verify handshake (`META_VERIFY_TOKEN`, or `WHATSAPP_VERIFY_TOKEN` if empty).
- `POST` on the same URLs accepts only deliveries signed with the app secret (`X-Hub-Signature-256`; `META_APP_SECRET`, or `WHATSAPP_APP_SECRET` if empty). Unsigned or wrongly signed → 401.
- Customer messages (text, images, video, audio, files, shares, button taps) land in the same inbox, channel **Messenger** / **Instagram**, with the person's name fetched once from Meta.
- Replies typed in the inbox go out through the Send API within the 24-hour window. Outside it, the message is kept and marked "Not delivered" with Meta's reason.
- Messages your team sends from Meta Business Suite / the Instagram app (echoes) are imported as agent messages. Delivery and read receipts update the ticks.
- Deduplicated on Meta's message id, so retries never create duplicates.

## Meta dashboard (same app as WhatsApp)

1. **Messenger:** add the *Messenger* product → *Messenger API settings*.
   - Generate a Page access token for your Facebook Page (needs `pages_messaging`) → `MESSENGER_PAGE_ACCESS_TOKEN`.
   - Webhook: Callback URL `https://chat.fratelanza.com/api/webhooks/messenger`, Verify token = your verify token.
   - Subscribe the Page to: `messages`, `messaging_postbacks`, `message_echoes`, `message_deliveries`, `message_reads`.
2. **Instagram:** connect the Instagram professional account to the same Facebook Page, add *Instagram* → *API setup with Facebook login* (or Instagram login).
   - Token with `instagram_manage_messages` (Page token of the linked Page, or an Instagram-login token starting with `IG`) → `INSTAGRAM_ACCESS_TOKEN`.
   - Webhook: Callback URL `https://chat.fratelanza.com/api/webhooks/instagram`, same verify token. Subscribe to `messages`, `messaging_postbacks`, `messaging_seen`.
   - In the Instagram app: Settings → Messages → *Allow access to messages* must be on.
3. Until the app passes **App Review** for `pages_messaging` / `instagram_manage_messages`, only people with a role on the app (admins, developers, testers) can message it.

## Turn it on

```bash
cd /opt/fratelanza-chat/deploy
nano .env        # fill MESSENGER_PAGE_ACCESS_TOKEN and/or INSTAGRAM_ACCESS_TOKEN
docker compose up -d api
```

Then open **Settings → Channels → Test connection**: it reads the Page / account name from Meta (read-only) and shows the last webhook received.
