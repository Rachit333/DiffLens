import type { FastifyInstance } from "fastify";
import sql from "../db/client.js";
import { verifyWebhookSignature, type GitHubPushPayload } from "../services/github.js";
import { getQueue, type AnalysisJobData } from "../services/queue.js";

export async function webhookRoutes(app: FastifyInstance) {
  app.post<{ Body: string }>(
    "/webhook/github",
    { config: { rawBody: true } },
    async (request, reply) => {
      const eventType = request.headers["x-github-event"] as string;
      const signature = request.headers["x-hub-signature-256"] as string | undefined;
      const rawBody = (request as any).rawBody as string;

      if (!verifyWebhookSignature(rawBody, signature)) {
        return reply.status(401).send({ error: "Invalid signature" });
      }

      if (eventType !== "push") {
        return reply.status(200).send({ skipped: true, reason: `event '${eventType}' not handled` });
      }

      const payload = request.body as unknown as GitHubPushPayload;

      if (payload.ref?.startsWith("refs/tags/")) {
        return reply.status(200).send({ skipped: true, reason: "tag push" });
      }

      const repoFullName = payload.repository.full_name;
      const owner = payload.repository.owner.login ?? payload.repository.owner.name;
      const repoName = payload.repository.name;

      app.log.info({ repo: repoFullName, ref: payload.ref }, "Processing push event");

      // Upsert repo
      const [repo] = await sql`
        INSERT INTO repos (owner, name, full_name)
        VALUES (${owner}, ${repoName}, ${repoFullName})
        ON CONFLICT (full_name) DO UPDATE
          SET owner = EXCLUDED.owner, name = EXCLUDED.name
        RETURNING id
      `;

      // Enqueue one job per commit — return 202 immediately
      const queue = getQueue();
      const enqueued: string[] = [];

      for (const ghCommit of payload.commits ?? []) {
        const jobData: AnalysisJobData = {
          repoId: repo.id,
          owner,
          repoName,
          sha: ghCommit.id,
          message: ghCommit.message,
          authorName: ghCommit.author.name,
          authorEmail: ghCommit.author.email,
          timestamp: ghCommit.timestamp,
        };

        await queue.add(`analyse:${ghCommit.id}`, jobData, {
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 200,
        });

        enqueued.push(ghCommit.id.slice(0, 7));
      }

      return reply.status(202).send({ enqueued });
    }
  );
}