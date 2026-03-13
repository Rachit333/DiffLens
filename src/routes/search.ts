import type { FastifyInstance } from "fastify";
import sql from "../db/client.js";

export async function searchRoutes(app: FastifyInstance) {
  /**
   * GET /search?q=auth&repo=owner/name&page=1
   *
   * Full-text search across commit messages, AI summaries, impact, and risks.
   * Optional repo filter. Paginated, 20 per page.
   */
  app.get<{
    Querystring: { q?: string; repo?: string; page?: string };
  }>("/search", async (request, reply) => {
    const q = (request.query.q ?? "").trim();
    const repo = (request.query.repo ?? "").trim();
    const limit = 20;
    const offset = (parseInt(request.query.page ?? "1", 10) - 1) * limit;

    if (!q) {
      return reply.send({ results: [], total: 0 });
    }

    const pattern = `%${q}%`;

    // Build query dynamically based on whether a repo filter is provided
    const results = repo
      ? await sql`
          SELECT
            c.sha,
            c.message,
            c.author_name,
            c.committed_at,
            r.full_name,
            r.owner,
            r.name,
            a.summary,
            a.impact
          FROM commits c
          JOIN repos r ON r.id = c.repo_id
          LEFT JOIN analyses a ON a.commit_id = c.id
          WHERE r.full_name = ${repo}
            AND (
              c.message    ILIKE ${pattern}
              OR a.summary ILIKE ${pattern}
              OR a.impact  ILIKE ${pattern}
              OR a.risks   ILIKE ${pattern}
              OR a.why     ILIKE ${pattern}
            )
          ORDER BY c.committed_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      : await sql`
          SELECT
            c.sha,
            c.message,
            c.author_name,
            c.committed_at,
            r.full_name,
            r.owner,
            r.name,
            a.summary,
            a.impact
          FROM commits c
          JOIN repos r ON r.id = c.repo_id
          LEFT JOIN analyses a ON a.commit_id = c.id
          WHERE
            c.message    ILIKE ${pattern}
            OR a.summary ILIKE ${pattern}
            OR a.impact  ILIKE ${pattern}
            OR a.risks   ILIKE ${pattern}
            OR a.why     ILIKE ${pattern}
          ORDER BY c.committed_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;

    const [{ total }] = repo
      ? await sql`
          SELECT COUNT(*)::int AS total
          FROM commits c
          JOIN repos r ON r.id = c.repo_id
          LEFT JOIN analyses a ON a.commit_id = c.id
          WHERE r.full_name = ${repo}
            AND (
              c.message ILIKE ${pattern} OR a.summary ILIKE ${pattern}
              OR a.impact ILIKE ${pattern} OR a.risks ILIKE ${pattern}
              OR a.why ILIKE ${pattern}
            )
        `
      : await sql`
          SELECT COUNT(*)::int AS total
          FROM commits c
          LEFT JOIN analyses a ON a.commit_id = c.id
          WHERE
            c.message ILIKE ${pattern} OR a.summary ILIKE ${pattern}
            OR a.impact ILIKE ${pattern} OR a.risks ILIKE ${pattern}
            OR a.why ILIKE ${pattern}
        `;

    return reply.send({ results, total, page: parseInt(request.query.page ?? "1", 10), limit });
  });

  /**
   * GET /job-status/:sha
   *
   * Returns whether a commit has been analysed yet.
   * Frontend polls this while showing a "processing" state.
   */
  app.get<{ Params: { sha: string } }>(
    "/job-status/:sha",
    async (request, reply) => {
      const { sha } = request.params;

      const [row] = await sql`
        SELECT a.id
        FROM commits c
        LEFT JOIN analyses a ON a.commit_id = c.id
        WHERE c.sha = ${sha}
      `;

      if (!row) return reply.status(404).send({ error: "Commit not found" });
      return reply.send({ sha, analysed: !!row.id });
    }
  );
}