import { Queue, Worker, Job } from "bullmq";
import { fetchCommitDiff } from "./github.js";
import { analyzeCommit } from "./ai.js";
import sql from "../db/client.js";

function getRedisConnection() {
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL is not set");
  const url = new URL(process.env.REDIS_URL);
  return {
    host: url.hostname,
    port: parseInt(url.port || "6379", 10),
    maxRetriesPerRequest: null,
  };
}
export interface AnalysisJobData {
  repoId: string;
  owner: string;
  repoName: string;
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  timestamp: string;
}

let queue: Queue | null = null;

export function getQueue(): Queue {
  if (!queue) {
    queue = new Queue("analysis", { connection: getRedisConnection() });
  }
  return queue;
}

export function startWorker() {
  const worker = new Worker<AnalysisJobData>(
    "analysis",
    async (job: Job<AnalysisJobData>) => {
      const { repoId, owner, repoName, sha, message, authorName, authorEmail, timestamp } = job.data;

      // 1. Fetch diff
      const { diff, truncated } = await fetchCommitDiff(owner, repoName, sha);

      // 2. Upsert commit row
      const [commit] = await sql`
        INSERT INTO commits (
          repo_id, sha, message, author_name, author_email,
          committed_at, diff_text, diff_truncated
        ) VALUES (
          ${repoId}, ${sha}, ${message}, ${authorName}, ${authorEmail},
          ${new Date(timestamp)}, ${diff}, ${truncated}
        )
        ON CONFLICT (repo_id, sha) DO UPDATE
          SET diff_text      = EXCLUDED.diff_text,
              diff_truncated = EXCLUDED.diff_truncated,
              message        = EXCLUDED.message
        RETURNING id
      `;

      // 3. Run AI analysis
      const { analysis, rawResponse } = await analyzeCommit(message, diff, truncated);

      // 4. Upsert analysis
      await sql`
        INSERT INTO analyses (
          commit_id, summary, why, impact, risks, affected_files, raw_response
        ) VALUES (
          ${commit.id}, ${analysis.summary}, ${analysis.why}, ${analysis.impact},
          ${analysis.risks}, ${sql.json(analysis.affected_files)}, ${rawResponse}
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

      console.log(`[worker] Analysis complete: ${sha}`);
    },
    {
      connection: getRedisConnection(),
      concurrency: 3, // process up to 3 commits in parallel
    }
  );

  worker.on("failed", (job, err) => {
    console.error(`[worker] Job failed ${job?.id}:`, err.message);
  });

  return worker;
}