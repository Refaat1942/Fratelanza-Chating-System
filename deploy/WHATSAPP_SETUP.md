# WhatsApp Cloud API (Meta) setup

## What the server does
| Endpoint | Purpose |
|---|---|
| `GET  /api/webhooks/whatsapp` | Meta's one-time verification (`hub.challenge`), checked against `WHATSAPP_VERIFY_TOKEN` |
| `POST /api/webhooks/whatsapp` | Inbound messages + delivery/read/failed statuses. Every request's `X-Hub-Signature-256` is verified with `WHATSAPP_APP_SECRET`; unsigned/invalid → 401, secret not set → 503 (fails closed) |
| `POST /api/conversations/:id/messages` | Agent replies are sent via `graph.facebook.com/<ver>/<PHONE_NUMBER_ID>/messages` when `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` are set. Internal notes are never sent. A failed send is stored as `failed` and shown as "Not delivered" |

Behaviour notes
* Retries from Meta are de-duplicated on the message id (`messages.external_id`, unique).
* Customers are matched by digits, so `+20 100…`, `0100…` and Meta's `2010…` are one customer; unknown numbers create a customer (`+<digits>`, tag *New*).
* A customer reply re-opens the existing open/pending conversation instead of creating a new one; new/queued chats go through auto-assignment.
* Status callbacks never move a message backwards (read → delivered is ignored).
* Free-form text only works inside WhatsApp's **24-hour customer-service window**. Outside it Meta rejects the send (error 131047) — approved *template* messages would be needed (not implemented).
* Inbound media is recorded as a placeholder (`[Image]`, `[Document] …`); media download is not implemented.

## Meta dashboard
1. developers.facebook.com → your app → **WhatsApp → Configuration**.
2. **Callback URL**: `https://<your-https-domain>/api/webhooks/whatsapp` — Meta requires a valid HTTPS certificate (use the nginx example in `nginx-host-chat.conf.example`; port 17156 itself stays on loopback).
3. **Verify token**: the value of `WHATSAPP_VERIFY_TOKEN` in `deploy/.env`.
4. After "Verify and save", under *Webhook fields* subscribe to **messages**.
5. `WHATSAPP_APP_SECRET`: App settings → Basic → App secret.
6. `WHATSAPP_PHONE_NUMBER_ID`: WhatsApp → API Setup.
7. `WHATSAPP_ACCESS_TOKEN`: create a **System User** in Business Settings, give it the app + `whatsapp_business_messaging` / `whatsapp_business_management`, generate a never-expiring token. (The temporary token on the API Setup page expires in ~24 h.)
8. `cd deploy && docker compose up -d` to apply env changes.

Do not commit tokens; `deploy/.env` is git-ignored.

## Sending is OFF by default (safety switch)
`WHATSAPP_SENDING_ENABLED` in `deploy/.env` controls whether the CRM may send
anything to customers. While it is `false` (the default, and also when the line
is missing):
* replies typed in the inbox are saved as **internal notes only** — the API
  refuses customer-facing messages (HTTP 403 `OUTBOUND_DISABLED`);
* campaigns cannot be sent and scheduled campaigns stay waiting;
* receiving messages, delivery receipts, phone-app sync and history import keep working.

To allow sending later: set `WHATSAPP_SENDING_ENABLED=true` and run
`cd /opt/fratelanza-chat/deploy && docker compose up -d`.

## Sync with the WhatsApp Business app on your phone (Coexistence)
If the same number is used in the **WhatsApp Business app and the Cloud API**
("Coexistence" onboarding), tick these extra webhook fields in Meta → your app →
WhatsApp → Configuration → Webhook fields:

| Field | What the CRM does |
|---|---|
| `smb_message_echoes` | Replies you send **from the phone** appear in the chat as your messages; the chat is marked handled (unread 0, waiting for customer) |
| `history` | Past chats shared during onboarding are imported with their original dates (older than 7 days are filed as completed so they don't flood the inbox) |
| `smb_app_state_sync` | Contact names saved on the phone replace auto-generated "+20…" names (existing customers only — the address book is not imported) |

Nothing is ever sent by these. If the fields are not in the list, the number is
not on Coexistence (Cloud API only) and the phone app cannot be synced.

**Lists / labels made in the phone app cannot be synced** — Meta does not expose
them through any API. Use the CRM's lists instead: in the inbox press *Select*,
tick chats, *Add to list*; filter with *All lists*.

## Topics (grouping by content)
Chats are sorted into topics from the customer's words (Settings → Chat Topics:
English/Arabic keywords per topic). A topic chosen by hand is never changed.
Ten default topics are created once on first start; edit or delete them freely.
