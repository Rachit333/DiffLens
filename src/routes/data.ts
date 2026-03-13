import type { FastifyInstance } from "fastify";
import sql from "../db/client.js";

export async function dataRoutes(app: FastifyInstance) {
  // ── GET /repos ─────────────────────────────────────────────────────────
  // List all repos that have had at least one push event.
  app.get("/repos", async (_req, reply) => {
    const repos = await sql`
      SELECT
        r.id,
        r.owner,
        r.name,
        r.full_name,
        r.created_at,
        COUNT(c.id)::int AS commit_count,
        MAX(c.committed_at) AS last_commit_at
      FROM repos r
      LEFT JOIN commits c ON c.repo_id = r.id
      GROUP BY r.id
      ORDER BY last_commit_at DESC NULLS LAST
    `;
    return reply.send(repos);
  });

  // ── GET /repos/:owner/:repo/commits ─────────────────────────────────────
  // Paginated commit list for a repo, newest first.
  app.get<{
    Params: { owner: string; repo: string };
    Querystring: { page?: string; limit?: string };
  }>("/repos/:owner/:repo/commits", async (request, reply) => {
    const { owner, repo } = request.params;
    const limit = Math.min(parseInt(request.query.limit ?? "20", 10), 100);
    const offset = (parseInt(request.query.page ?? "1", 10) - 1) * limit;

    const fullName = `${owner}/${repo}`;

    const [repoRow] = await sql`
      SELECT id FROM repos WHERE full_name = ${fullName}
    `;
    if (!repoRow) return reply.status(404).send({ error: "Repository not found" });

    const commits = await sql`
      SELECT
        c.id,
        c.sha,
        c.message,
        c.author_name,
        c.author_email,
        c.committed_at,
        c.diff_truncated,
        a.summary,
        a.created_at AS analysed_at
      FROM commits c
      LEFT JOIN analyses a ON a.commit_id = c.id
      WHERE c.repo_id = ${repoRow.id}
      ORDER BY c.committed_at DESC NULLS LAST
      LIMIT ${limit} OFFSET ${offset}
    `;

    const [{ total }] = await sql`
      SELECT COUNT(*)::int AS total FROM commits WHERE repo_id = ${repoRow.id}
    `;

    return reply.send({ commits, total, page: parseInt(request.query.page ?? "1", 10), limit });
  });

  // ── GET /repos/:owner/:repo/commits/:sha ─────────────────────────────────
  // Full commit detail including diff and complete analysis.
  app.get<{
    Params: { owner: string; repo: string; sha: string };
  }>("/repos/:owner/:repo/commits/:sha", async (request, reply) => {
    const { owner, repo, sha } = request.params;
    const fullName = `${owner}/${repo}`;

    const [row] = await sql`
      SELECT
        c.id,
        c.sha,
        c.message,
        c.author_name,
        c.author_email,
        c.committed_at,
        c.diff_text,
        c.diff_truncated,
        a.summary,
        a.why,
        a.impact,
        a.risks,
        a.affected_files,
        a.created_at AS analysed_at
      FROM commits c
      JOIN repos r ON r.id = c.repo_id
      LEFT JOIN analyses a ON a.commit_id = c.id
      WHERE r.full_name = ${fullName}
        AND c.sha = ${sha}
    `;

    if (!row) return reply.status(404).send({ error: "Commit not found" });
    return reply.send(row);
  });
}
