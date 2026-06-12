# Security and deployment

## Render environment variables

Configure these values in Render Dashboard under **Environment**. Never commit them:

```text
BOT_TOKEN=<new Telegram bot token>
ADMIN_ID=<Telegram administrator ID>
SESSION_SECRET=<at least 32 random characters>
CORS_ORIGINS=null
DATA_DIR=/var/data
```

Generate a session secret with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`npm start` runs the main bot and subscription API.

Attach a persistent Render Disk at `/var/data`. Without a disk or database, keys and rentals can disappear after a redeploy.

Recommended Render settings:

```text
Runtime: Node
Node version: 22
Build command: npm ci --omit=dev
Start command: npm start
Health check path: /status
```

For the desktop application, set `API_BASE` to the public Render service URL before launching or packaging:

```powershell
$env:API_BASE="https://your-service.onrender.com"
npm run desktop
```

For a distributed build, replace `DEFAULT_API_BASE` in `preload.js` with the real Render URL before packaging.

The optional payment webhook is a separate service and uses:

```text
PAYMENT_BOT_TOKEN=<new payment bot token>
ADMIN_ID=<Telegram administrator ID>
PAYMENT_WEBHOOK_SECRET=<at least 32 random characters>
DATA_DIR=/var/data
```

Its start command is:

```text
npm run start:payments
```

The payment provider must send:

```text
X-Webhook-Signature: sha256=<HMAC-SHA256 of the exact request body>
```

## Subscription model

- Activation keys are stored as SHA-256 hashes.
- Activation returns a signed, expiring session token.
- Protected API routes require `Authorization: Bearer <session token>`.
- The desktop session token is stored through Electron `safeStorage`, not `localStorage`.
- The expiry date in `localStorage` is display-only. The server remains authoritative.

Desktop software running on a user's own computer cannot provide unbreakable DRM: a determined user can patch local application code. Server-side authorization protects server resources and Telegram operations even if the local UI is modified.

## Exposed credentials

Tokens previously committed to Git must be revoked in BotFather. Removing them from the current files does not remove them from Git history.

History cleanup requires coordination with the repository owner:

```powershell
git filter-repo --replace-text replacements.txt --force
git push --force --all
git push --force --tags
```

Do this only after all collaborators have been warned, because it rewrites commit hashes.
