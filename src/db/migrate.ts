/**
 * V1 schema migration.
 * Run once: npm run migrate
 *
 * Three tables:
 *   repos    — one row per GitHub repository seen by the webhook
 *   commits  — one row per commit pushed, including the raw diff text
 *   analyses — one row per commit, containing the AI-generated documentation
 */

import { config } from "dotenv";
config();
console.log("DATABASE_URL:", process.env.DATABASE_URL);

import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const sql = postgres(process.env.DATABASE_URL);

async function migrate() {
  console.log("Running migrations…");

  await sql`
    CREATE TABLE IF NOT EXISTS repos (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      owner       TEXT        NOT NULL,
      name        TEXT        NOT NULL,
      full_name   TEXT        NOT NULL UNIQUE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS commits (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      repo_id       UUID        NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      sha           TEXT        NOT NULL,
      message       TEXT        NOT NULL DEFAULT '',
      author_name   TEXT        NOT NULL DEFAULT '',
      author_email  TEXT        NOT NULL DEFAULT '',
      committed_at  TIMESTAMPTZ,
      diff_text     TEXT,
      diff_truncated BOOLEAN    NOT NULL DEFAULT FALSE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (repo_id, sha)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS commits_repo_id_idx ON commits(repo_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS commits_committed_at_idx ON commits(committed_at DESC)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS analyses (
      id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      commit_id       UUID        NOT NULL UNIQUE REFERENCES commits(id) ON DELETE CASCADE,
      summary         TEXT,
      why             TEXT,
      impact          TEXT,
      risks           TEXT,
      affected_files  JSONB       NOT NULL DEFAULT '[]',
      raw_response    TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  console.log("✓ Migrations complete");
  await sql.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
