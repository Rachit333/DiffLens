import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface CommitAnalysis {
  summary: string;
  why: string;
  impact: string;
  risks: string;
  affected_files: Array<{
    path: string;
    change_type: "added" | "modified" | "deleted" | "renamed";
    description: string;
  }>;
}

const SYSTEM_PROMPT = `You are a senior software engineer analyzing Git commit diffs.
Your job is to produce clear, accurate technical documentation for each code change.

You MUST respond with a single valid JSON object and nothing else — no markdown fences,
no preamble, no explanation outside the JSON.

The JSON must match this exact shape:
{
  "summary": "One sentence describing what changed",
  "why": "Your best inference of why this change was made, based on the code and commit message",
  "impact": "How this change affects system behavior, APIs, performance, or data",
  "risks": "Potential side effects, regressions, or areas that need testing. Write 'None identified' if minimal",
  "affected_files": [
    {
      "path": "relative/path/to/file.ts",
      "change_type": "added|modified|deleted|renamed",
      "description": "One sentence on what changed in this specific file"
    }
  ]
}

Guidelines:
- Be specific and technical, not generic ("updates error handling in auth middleware" not "improves code")
- If the diff is truncated, note that in impact and avoid claiming full coverage
- Keep each field concise: 1–3 sentences max
- affected_files should list every file touched, max 20 entries`;

/**
 * Analyze a commit diff using Claude and return structured documentation.
 */
export async function analyzeCommit(
  commitMessage: string,
  diff: string,
  diffTruncated: boolean
): Promise<{ analysis: CommitAnalysis; rawResponse: string }> {
  const userMessage = `Commit message: ${commitMessage}
${diffTruncated ? "\nNote: This diff was truncated due to size. Analyze what is visible.\n" : ""}
Diff:
${diff}`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const rawResponse = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  let analysis: CommitAnalysis;
  try {
    // Strip any accidental markdown fences before parsing
    const cleaned = rawResponse.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    analysis = JSON.parse(cleaned) as CommitAnalysis;
  } catch {
    // If parsing fails, wrap the raw response in a minimal valid structure
    // so we always have something to store rather than a hard failure.
    analysis = {
      summary: "Analysis could not be parsed — see raw response",
      why: "",
      impact: "",
      risks: "",
      affected_files: [],
    };
    console.error("Failed to parse AI response as JSON:", rawResponse);
  }

  return { analysis, rawResponse };
}
