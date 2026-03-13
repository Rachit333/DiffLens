import crypto from "crypto";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? "";
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? "";
const DIFF_CHAR_LIMIT = parseInt(process.env.DIFF_CHAR_LIMIT ?? "40000", 10);

/**
 * Verify the X-Hub-Signature-256 header sent by GitHub.
 * Returns true if the payload matches the configured secret.
 */
export function verifyWebhookSignature(
  payload: string,
  signatureHeader: string | undefined
): boolean {
  if (!WEBHOOK_SECRET) {
    // If no secret is configured, skip verification (dev only — set this in prod).
    console.warn("GITHUB_WEBHOOK_SECRET is not set — skipping signature check");
    return true;
  }

  if (!signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const expected = "sha256=" + crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(payload, "utf8")
    .digest("hex");

  // Use timingSafeEqual to prevent timing attacks.
  return crypto.timingSafeEqual(
    Buffer.from(signatureHeader),
    Buffer.from(expected)
  );
}

/**
 * Fetch the unified diff for a single commit from the GitHub API.
 * Returns { diff, truncated } — truncated is true when the diff exceeded DIFF_CHAR_LIMIT.
 */
export async function fetchCommitDiff(
  owner: string,
  repo: string,
  sha: string
): Promise<{ diff: string; truncated: boolean }> {
  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${sha}`;

  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.diff",
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "User-Agent": "commit-intel/1.0",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error ${res.status} fetching ${sha}: ${body}`);
  }

  const fullDiff = await res.text();

  if (fullDiff.length <= DIFF_CHAR_LIMIT) {
    return { diff: fullDiff, truncated: false };
  }

  // Hard truncate and append a note so the AI knows the diff was cut.
  const truncated = fullDiff.slice(0, DIFF_CHAR_LIMIT) +
    "\n\n[DIFF TRUNCATED: The diff exceeded the analysis limit. " +
    `The first ${DIFF_CHAR_LIMIT} characters are shown above.]`;

  return { diff: truncated, truncated: true };
}

// ────────────────────────────────────────────────────────────────────────────
// Types mirroring the GitHub push webhook payload (only fields we use)
// ────────────────────────────────────────────────────────────────────────────

export interface GitHubPushPayload {
  ref: string;
  repository: {
    id: number;
    name: string;
    full_name: string;
    owner: { name: string; login: string };
  };
  commits: Array<{
    id: string;
    message: string;
    author: { name: string; email: string };
    timestamp: string;
  }>;
  head_commit: {
    id: string;
    message: string;
    author: { name: string; email: string };
    timestamp: string;
  } | null;
}
