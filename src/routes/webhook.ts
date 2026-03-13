import type { FastifyInstance } from "fastify";
import sql from "../db/client.js";
import { verifyWebhookSignature, fetchCommitDiff, type GitHubPushPayload } from "../services/github.js";
import { analyzeCommit } from "../services/ai.js";

export async function webhookRoutes(app: FastifyInstance) {
  /**
   * POST /webhook/github
   *
   * Receives GitHub push events. For each commit in the push:
   *   1. Upsert the repo row
   *   2. Fetch the diff from the GitHub API
   *   3. Store the commit
   *   4. Call Claude for analysis
   *   5. Store the analysis
   *
   * Always returns 200 quickly — GitHub will retry if we return 4xx/5xx.
   * Heavy work happens synchronously for V1 (V2 moves this to a queue).
   */
  app.post<{ Body: string }>(
    "/webhook/github",
    {
      config: { rawBody: true },
    },
    async (request, reply) => {
      const eventType = request.headers["x-github-event"] as string;
      const signature = request.headers["x-hub-signature-256"] as string | undefined;
      const rawBody = (request as any).rawBody as string;

      // ── 1. Signature verification ──────────────────────────────────────
      if (!verifyWebhookSignature(rawBody, signature)) {
        return reply.status(401).send({ error: "Invalid signature" });
      }

      // We only care about push events for V1
      if (eventType !== "push") {
        return reply.status(200).send({ skipped: true, reason: `event '${eventType}' not handled` });
      }

      const payload = request.body as unknown as GitHubPushPayload;

      // Skip tag pushes (ref starts with refs/tags/)
      if (payload.ref?.startsWith("refs/tags/")) {
        return reply.status(200).send({ skipped: true, reason: "tag push" });
      }

      const repoFullName = payload.repository.full_name;
      const owner = payload.repository.owner.login ?? payload.repository.owner.name;
      const repoName = payload.repository.name;

      app.log.info({ repo: repoFullName, ref: payload.ref }, "Processing push event");

      // ── 2. Upsert repo ─────────────────────────────────────────────────
      const [repo] = await sql`
        INSERT INTO repos (owner, name, full_name)
        VALUES (${owner}, ${repoName}, ${repoFullName})
        ON CONFLICT (full_name) DO UPDATE
          SET owner = EXCLUDED.owner,
              name  = EXCLUDED.name
        RETURNING id
      `;

      // ── 3. Process each commit ─────────────────────────────────────────
      const results: Array<{ sha: string; status: string; error?: string }> = [];

      for (const ghCommit of payload.commits ?? []) {
        const sha = ghCommit.id;

        try {
          // Fetch the unified diff from GitHub
          const { diff, truncated } = await fetchCommitDiff(owner, repoName, sha);

          // Upsert the commit row
          const [commit] = await sql`
            INSERT INTO commits (
              repo_id, sha, message, author_name, author_email,
              committed_at, diff_text, diff_truncated
            ) VALUES (
              ${repo.id},
              ${sha},
              ${ghCommit.message},
              ${ghCommit.author.name},
              ${ghCommit.author.email},
              ${new Date(ghCommit.timestamp)},
              ${diff},
              ${truncated}
            )
            ON CONFLICT (repo_id, sha) DO UPDATE
              SET diff_text      = EXCLUDED.diff_text,
                  diff_truncated = EXCLUDED.diff_truncated,
                  message        = EXCLUDED.message
            RETURNING id
          `;

          // Run AI analysis
          const { analysis, rawResponse } = await analyzeCommit(
            ghCommit.message,
            diff,
            truncated
          );

          // Upsert analysis (if the commit was pushed again we refresh the analysis)
          await sql`
            INSERT INTO analyses (
              commit_id, summary, why, impact, risks, affected_files, raw_response
            ) VALUES (
              ${commit.id},
              ${analysis.summary},
              ${analysis.why},
              ${analysis.impact},
              ${analysis.risks},
              ${sql.json(analysis.affected_files)},
              ${rawResponse}
            )
            ON CONFLICT (commit_id) DO UPDATE
              SET summary        = EXCLUDED.summary,
                  why            = EXCLUDED.why,
                  impact         = EXCLUDED.impact,
                  risks          = EXCLUDED.risks,
                  affected_files = EXCLUDED.affected_files,
                  raw_response   = EXCLUDED.raw_response,
                  created_at     = NOW()
          `;

          app.log.info({ sha }, "Analysis complete");
          results.push({ sha, status: "analysed" });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          app.log.error({ sha, err: message }, "Failed to process commit");
          results.push({ sha, status: "error", error: message });
        }
      }

      return reply.status(200).send({ processed: results });
    }
  );
}
