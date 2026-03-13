# commit-intel-api

Fastify backend that receives GitHub push webhooks, fetches commit diffs, and generates structured AI documentation using Claude.

## Prerequisites

- Node.js 20+
- PostgreSQL 15+ running locally (`brew install postgresql` or use Postgres.app on macOS)
- An Anthropic API key
- A GitHub personal access token (for fetching diffs from private repos)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:
- `DATABASE_URL` — your local Postgres connection string
- `GITHUB_WEBHOOK_SECRET` — a random string you'll also enter in GitHub's webhook settings
- `GITHUB_TOKEN` — a GitHub PAT with `Contents: read` and `Metadata: read` scopes
- `ANTHROPIC_API_KEY` — from https://console.anthropic.com/

### 3. Create the database

```bash
psql postgres -c "CREATE DATABASE commit_intel;"
```

### 4. Run migrations

```bash
npm run migrate
```

### 5. Start the dev server

```bash
npm run dev
```

The API will be at `http://localhost:3001`.

---

## Exposing the webhook to GitHub (local dev)

GitHub needs a public URL to send push events to. Use [ngrok](https://ngrok.com/):

```bash
ngrok http 3001
```

Copy the `https://xxxx.ngrok-free.app` URL. Then in your GitHub repo:

1. **Settings → Webhooks → Add webhook**
2. Payload URL: `https://xxxx.ngrok-free.app/webhook/github`
3. Content type: `application/json`
4. Secret: the same value as `GITHUB_WEBHOOK_SECRET` in your `.env`
5. Events: select **"Just the push event"**
6. Active: ✓

Push a commit — the API log will show the analysis running.

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/webhook/github` | Receives GitHub push events |
| GET | `/repos` | List all tracked repositories |
| GET | `/repos/:owner/:repo/commits` | Paginated commit list (`?page=1&limit=20`) |
| GET | `/repos/:owner/:repo/commits/:sha` | Full commit detail with AI analysis |
| GET | `/health` | Health check |

---

## Project structure

```
src/
  index.ts              Server entry — registers plugins and routes
  db/
    client.ts           postgres.js singleton
    migrate.ts          Schema migration (run once)
  routes/
    webhook.ts          GitHub push event handler
    data.ts             Read-only data API for the frontend
  services/
    github.ts           Webhook signature verification + diff fetching
    ai.ts               Claude API call + response parsing
```
