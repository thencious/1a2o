import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const replacementModels = { "dots-studio/dots-3-note-preview:free": "nvidia/nemotron-3.5-super-vl:free" };

export function prepareRequest(input, freeOnly) {
  const body = structuredClone(input);
  if (!freeOnly) return body;
  if (typeof body.model === "string") body.model = replacementModels[body.model] ?? body.model;
  if (Array.isArray(body.models)) body.models = [...new Set(body.models.map(model => replacementModels[model] ?? model))];
  body.provider = { ...body.provider, require_parameters: true, max_price: { prompt: 0, completion: 0 } };
  if (body.max_tokens === undefined && body.max_completion_tokens === undefined) body.max_tokens = 8192;
  const model = body.model ?? body.models?.[0];
  if (model?.startsWith("nvidia/")) {
    // Anthropic-only cache markers turn plain text into provider-specific multipart input.
    body.messages = body.messages?.map(message => {
      if (!Array.isArray(message.content)) return message;
      const content = message.content.map(({ cache_control, ...part }) => part);
      return { ...message, content: content.every(part => part.type === "text") ? content.map(part => part.text).join("") : content };
    });
    delete body.prompt_cache_key;
  }
  return body;
}

export function requestRoute(body, feature) {
  const model = String(body.model ?? body.models?.[0]);
  const format = { response_format: body.response_format, tools: body.tools, tool_choice: body.tool_choice, reasoning: body.reasoning };
  const key = createHash("sha256").update(JSON.stringify([model, feature, format])).digest("hex");
  return { key, model, feature };
}

export function failureDetails(status, errorBody, fallback = "upstream_error") {
  const error = errorBody?.error;
  const provider = typeof error?.metadata?.provider_name === "string" && /^[a-zA-Z0-9 ._-]{1,80}$/.test(error.metadata.provider_name) ? error.metadata.provider_name : null;
  const category = status === 400 || status === 422 ? "invalid_request" : status === 401 || status === 403 ? "authorization" : status === 429 ? "rate_limit" : status === 404 ? "model_unavailable" : status >= 500 ? "provider_unavailable" : fallback;
  return { provider, category };
}

export function createRouteHealth(path) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS route_health (key TEXT PRIMARY KEY, model TEXT NOT NULL, feature TEXT NOT NULL, failures INTEGER NOT NULL DEFAULT 0, until INTEGER NOT NULL DEFAULT 0, status INTEGER, category TEXT, provider TEXT);`);
  return {
    paused(key, now = Date.now()) { const row = db.prepare("SELECT * FROM route_health WHERE key=? AND until>?").get(key, now); return row ?? null; },
    pauses(now = Date.now()) { return db.prepare("SELECT model,feature,until,status,category,provider FROM route_health WHERE until>? ORDER BY until DESC").all(now); },
    failed(route, status, details, now = Date.now()) {
      const permanent = [400,401,403,404,422].includes(status);
      const threshold = permanent ? 2 : 3;
      const cooldown = permanent ? 6 * 3600000 : status === 429 ? 60000 : 300000;
      db.prepare(`INSERT INTO route_health(key,model,feature,failures,until,status,category,provider) VALUES(?,?,?,1,0,?,?,?)
        ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN route_health.until>0 AND route_health.until<=? THEN 1 ELSE route_health.failures+1 END,until=0,status=excluded.status,category=excluded.category,provider=excluded.provider`).run(route.key,route.model,route.feature,status,details.category,details.provider,now);
      db.prepare("UPDATE route_health SET until=? WHERE key=? AND failures>=?").run(now+cooldown,route.key,threshold);
    },
    succeeded(key) { db.prepare("DELETE FROM route_health WHERE key=?").run(key); },
    close() { db.close(); },
  };
}
