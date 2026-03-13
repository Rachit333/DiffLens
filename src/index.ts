import { config } from "dotenv";
config();
import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { webhookRoutes } from "./routes/webhook.js";
import { dataRoutes } from "./routes/data.js";

const PORT = parseInt(process.env.PORT ?? "3001", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

const app = Fastify({
  logger: {
    transport:
      process.env.NODE_ENV !== "production"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  },
});

// ── Plugins ──────────────────────────────────────────────────────────────────
await app.register(sensible);

// GitHub webhook verification requires the raw request body as a string.
// Fastify parses JSON by default — we intercept the content-type to keep raw access.
app.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (req, body, done) => {
    // Attach raw body before parsing so the webhook route can verify the signature
    (req as any).rawBody = body;
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  }
);

// ── CORS — allow the Next.js frontend in dev ──────────────────────────────
app.addHook("onRequest", (req, reply, done) => {
  const origin = process.env.FRONTEND_URL ?? "http://localhost:3000";
  reply.header("Access-Control-Allow-Origin", origin);
  reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  reply.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    reply.status(204).send();
    return;
  }
  done();
});

// ── Routes ────────────────────────────────────────────────────────────────
await app.register(webhookRoutes);
await app.register(dataRoutes);

app.get("/health", async () => ({ status: "ok", ts: new Date().toISOString() }));

// ── Start ─────────────────────────────────────────────────────────────────
try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`API listening on http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
