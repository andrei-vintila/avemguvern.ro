/**
 * avemguvern.ro — Does Romania have a (full, non-interim) government?
 *
 * A single Cloudflare Worker that:
 *   - serves the static page (via the ASSETS binding),
 *   - exposes a small public JSON API at /api/status,
 *   - exposes a read-only MCP server (Streamable HTTP) at /mcp.
 *
 * State lives in one KV key (`current`). If it's missing we fall back to the
 * hardcoded DEFAULT_STATUS, so the site works before the namespace is seeded.
 */

export interface Env {
  ASSETS: Fetcher;
  GOV_STATUS: KVNamespace;
  ADMIN_TOKEN?: string;
}

interface GovernmentStatus {
  hasGovernment: boolean;
  answer: string;
  subtitle: string;
  primeMinister: string;
  interim: boolean;
  updatedAt: string;
}

const KV_KEY = "current";

const DEFAULT_STATUS: GovernmentStatus = {
  hasGovernment: false,
  answer: "Nu!",
  subtitle: "Inca e interimar Bolojan!",
  primeMinister: "Ilie Bolojan",
  interim: true,
  updatedAt: "2026-06-30T00:00:00.000Z",
};

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version",
};

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

async function readStatus(env: Env): Promise<GovernmentStatus> {
  const raw = await env.GOV_STATUS.get(KV_KEY);
  if (!raw) return DEFAULT_STATUS;
  try {
    return { ...DEFAULT_STATUS, ...(JSON.parse(raw) as Partial<GovernmentStatus>) };
  } catch {
    return DEFAULT_STATUS;
  }
}

async function writeStatus(env: Env, status: GovernmentStatus): Promise<void> {
  await env.GOV_STATUS.put(KV_KEY, JSON.stringify(status));
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
      ...(init.headers ?? {}),
    },
  });
}

// ---------------------------------------------------------------------------
// API: /api/status
// ---------------------------------------------------------------------------

async function handleApiStatus(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    const status = await readStatus(env);
    return json(status, { headers: { "Cache-Control": "public, max-age=60" } });
  }

  if (request.method === "POST") {
    const auth = request.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    let patch: Partial<GovernmentStatus>;
    try {
      patch = (await request.json()) as Partial<GovernmentStatus>;
    } catch {
      return json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const current = await readStatus(env);
    const next: GovernmentStatus = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await writeStatus(env, next);
    return json(next);
  }

  return json({ error: "Method not allowed" }, { status: 405 });
}

// ---------------------------------------------------------------------------
// MCP: /mcp  (stateless JSON-RPC 2.0 over Streamable HTTP)
// ---------------------------------------------------------------------------

const PROTOCOL_VERSION = "2025-06-18";

const GET_STATUS_TOOL = {
  name: "get_government_status",
  title: "Get Romania's government status",
  description:
    "Returns whether Romania currently has a full (non-interim) government, " +
    "including the current prime minister and a human-readable answer in Romanian.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
};

function rpcResult(id: unknown, result: unknown): Response {
  return json({ jsonrpc: "2.0", id, result });
}

function rpcError(id: unknown, code: number, message: string): Response {
  return json({ jsonrpc: "2.0", id, error: { code, message } });
}

function mcpInfoPage(origin: string): string {
  const endpoint = `${origin}/mcp`;
  const cmd = `claude mcp add --transport http avemguvern ${endpoint}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>avemguvern.ro — MCP</title>
<style>
  :root { --bg:#0a0a0f; --fg:#f5f5f7; --muted:#8a8a99; --yellow:#fcd116; }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--fg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px;line-height:1.6}
  main{max-width:680px}
  h1{font-size:1.5rem;margin-bottom:.5em}
  p{color:var(--muted);margin-bottom:1.2em}
  .label{font-size:.8rem;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin:1.4em 0 .5em}
  pre{background:#16161f;border:1px solid #26263a;border-radius:10px;padding:14px 16px;overflow-x:auto;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9rem;color:#e6e6ea}
  code{font-family:inherit}
  a{color:var(--yellow);text-decoration:none}
  .top{height:5px;width:100%;position:fixed;top:0;left:0;
    background:linear-gradient(to right,#002b7f 0 33.33%,#fcd116 33.33% 66.66%,#ce1126 66.66% 100%)}
</style></head>
<body><div class="top"></div><main>
  <h1>🏛️ avemguvern.ro — MCP server</h1>
  <p>A read-only MCP server with one tool, <code>get_government_status</code>, that tells you whether Romania currently has a (full, non-interim) government.</p>

  <div class="label">Add to Claude Code</div>
  <pre><code>${cmd}</code></pre>

  <div class="label">Add to Claude Desktop / other clients (HTTP transport)</div>
  <pre><code>{
  "mcpServers": {
    "avemguvern": {
      "type": "http",
      "url": "${endpoint}"
    }
  }
}</code></pre>

  <p style="margin-top:2em"><a href="/">← Back to avemguvern.ro</a></p>
</main></body></html>`;
}

async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    // Browsers / humans landing on /mcp get setup instructions.
    // MCP clients use POST; we don't offer a server-initiated SSE stream.
    const accept = request.headers.get("Accept") ?? "";
    const origin = new URL(request.url).origin;
    if (accept.includes("text/html")) {
      return new Response(mcpInfoPage(origin), {
        headers: { "Content-Type": "text/html; charset=utf-8", ...CORS_HEADERS },
      });
    }
    const cmd = `claude mcp add --transport http avemguvern ${origin}/mcp`;
    return new Response(
      `avemguvern.ro MCP server (read-only)\n\nAdd to Claude Code:\n  ${cmd}\n\nClients connect via HTTP POST (JSON-RPC) to ${origin}/mcp\n`,
      { headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS_HEADERS } },
    );
  }
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
  }

  let msg: any;
  try {
    msg = await request.json();
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  // Batches aren't needed for this server.
  if (Array.isArray(msg)) {
    return rpcError(null, -32600, "Batch requests are not supported");
  }

  const { id, method, params } = msg ?? {};

  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion:
          (params && params.protocolVersion) || PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "avemguvern-ro", version: "1.0.0" },
        instructions:
          "Use get_government_status to check whether Romania currently has a government.",
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      // Notifications get no JSON-RPC response body.
      return new Response(null, { status: 202, headers: CORS_HEADERS });

    case "ping":
      return rpcResult(id, {});

    case "tools/list":
      return rpcResult(id, { tools: [GET_STATUS_TOOL] });

    case "tools/call": {
      const name = params?.name;
      if (name !== GET_STATUS_TOOL.name) {
        return rpcError(id, -32602, `Unknown tool: ${name}`);
      }
      const status = await readStatus(env);
      const sentence = status.hasGovernment
        ? `Romania are guvern. ${status.subtitle}`
        : `Romania nu are guvern. ${status.subtitle}`;
      return rpcResult(id, {
        content: [
          { type: "text", text: sentence },
          { type: "text", text: JSON.stringify(status, null, 2) },
        ],
        structuredContent: status,
        isError: false,
      });
    }

    default:
      if (id === undefined) {
        // Unknown notification — ignore.
        return new Response(null, { status: 202, headers: CORS_HEADERS });
      }
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/api/status") {
      return handleApiStatus(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, { status: 404 });
    }

    if (url.pathname === "/mcp") {
      return handleMcp(request, env);
    }

    // Everything else: static assets (index.html, etc.)
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
