import { GoogleGenerativeAI } from "@google/generative-ai";

function getClient() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

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

export async function analyzeCommit(
  commitMessage: string,
  diff: string,
  diffTruncated: boolean
): Promise<{ analysis: CommitAnalysis; rawResponse: string }> {
  const model = getClient().getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: SYSTEM_PROMPT,
  });

  const userMessage = `Commit message: ${commitMessage}
${diffTruncated ? "\nNote: This diff was truncated due to size. Analyze what is visible.\n" : ""}
Diff:
${diff}`;

  const result = await model.generateContent(userMessage);
  const rawResponse = result.response.text();

  let analysis: CommitAnalysis;
  try {
    let cleaned = rawResponse.trim();
    if (cleaned.startsWith("```json")) {
      cleaned = cleaned.replace(/^```json\n?/, "").replace(/\n?```$/, "");
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```\n?/, "").replace(/\n?```$/, "");
    }
    analysis = JSON.parse(cleaned) as CommitAnalysis;
  } catch {
    analysis = {
      summary: "Analysis could not be parsed — see raw response",
      why: "",
      impact: "",
      risks: "",
      affected_files: [],
    };
    console.error("Failed to parse Gemini response as JSON:", rawResponse);
  }

  return { analysis, rawResponse };
}