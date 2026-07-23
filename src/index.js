// Relentless Billionaire - Elite AI Worker
// Cloudflare Workers - Production Build

export class AgentState {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/status") {
      const data = await this.state.storage.get("agent_status") || {
        status: "idle",
        last_check: new Date().toISOString(),
        version: "2.0"
      };
      return Response.json(data);
    }

    if (request.method === "POST") {
      try {
        const body = await request.json();
        await this.state.storage.put("agent_status", {
          ...body,
          updated: new Date().toISOString()
        });
        return Response.json({ ok: true, message: "Status updated" });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 400 });
      }
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // API Routes
    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/status") {
        try {
          const id = env.AGENT_STATE.idFromName("global");
          const stub = env.AGENT_STATE.get(id);
          const response = await stub.fetch(request);
          return new Response(response.body, {
            status: response.status,
            headers: { ...response.headers, ...corsHeaders }
          });
        } catch (e) {
          return Response.json(
            { error: "Failed to get status", details: e.message },
            { status: 500, headers: corsHeaders }
          );
        }
      }

      if (url.pathname === "/api/analyze") {
        return Response.json(
          {
            brand: env.BRAND || "Relentless Billionaire",
            status: "analysis_queued",
            timestamp: new Date().toISOString(),
            ai_available: !!env.AI,
            environment: env.ENVIRONMENT
          },
          { headers: corsHeaders }
        );
      }

      if (url.pathname === "/api/ai" && env.AI) {
        try {
          const prompt = url.searchParams.get("q") || "Analyze Relentless Billionaire project health";
          const result = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
            prompt,
            max_tokens: 512
          });
          return Response.json(result, { headers: corsHeaders });
        } catch (e) {
          return Response.json(
            { error: "AI service error", details: e.message },
            { status: 500, headers: corsHeaders }
          );
        }
      }

      if (url.pathname === "/api/health") {
        return Response.json(
          {
            status: "healthy",
            timestamp: new Date().toISOString(),
            services: {
              ai: !!env.AI,
              db: !!env.DB,
              cache: !!env.CACHE,
              models: !!env.MODELS_BUCKET
            }
          },
          { headers: corsHeaders }
        );
      }

      return Response.json({ error: "API route not found" }, { status: 404, headers: corsHeaders });
    }

    // Serve frontend
    return new Response(await fetchFrontend(env), {
      headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders }
    });
  }
};

async function fetchFrontend(env) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RELENTLESS BILLIONAIRE - ELITE AGENT v2.0</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      background: linear-gradient(135deg, #000 0%, #1a1a1a 100%);
      color: #FFD700;
      font-family: 'Courier New', monospace;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 900px;
      width: 100%;
    }
    .header {
      text-align: center;
      border: 3px solid #FFD700;
      padding: 40px 20px;
      margin-bottom: 30px;
      background: rgba(255, 215, 0, 0.05);
      box-shadow: 0 0 20px rgba(255, 215, 0, 0.2);
    }
    h1 {
      font-size: 3rem;
      letter-spacing: 5px;
      margin-bottom: 10px;
      text-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
    }
    .subtitle {
      font-size: 1.2rem;
      letter-spacing: 3px;
      color: #FFD700;
      opacity: 0.9;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .stat {
      border: 2px solid #FFD700;
      padding: 20px;
      background: rgba(255, 215, 0, 0.02);
      text-align: center;
    }
    .stat h3 {
      font-size: 0.9rem;
      letter-spacing: 2px;
      margin-bottom: 10px;
      text-transform: uppercase;
      color: #FFD700;
    }
    .stat p {
      font-size: 1.3rem;
      color: #00FF00;
      text-shadow: 0 0 5px rgba(0, 255, 0, 0.5);
    }
    .controls {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 15px;
      margin-bottom: 30px;
    }
    .btn {
      background: #FFD700;
      color: #000;
      padding: 15px 20px;
      border: 2px solid #FFD700;
      cursor: pointer;
      font-weight: bold;
      letter-spacing: 2px;
      font-family: 'Courier New', monospace;
      font-size: 0.9rem;
      transition: all 0.3s;
      text-transform: uppercase;
    }
    .btn:hover {
      background: transparent;
      color: #FFD700;
      box-shadow: 0 0 20px rgba(255, 215, 0, 0.5);
    }
    .btn:active {
      transform: scale(0.95);
    }
    .status-box {
      border: 2px solid #FFD700;
      padding: 20px;
      background: rgba(0, 0, 0, 0.5);
      min-height: 200px;
      overflow-y: auto;
      font-size: 0.9rem;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .status-box h4 {
      color: #FFD700;
      margin-bottom: 10px;
      letter-spacing: 2px;
    }
    .loading {
      color: #00FF00;
      animation: pulse 1s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .error {
      color: #FF4444;
    }
    .success {
      color: #00FF00;
    }
    footer {
      text-align: center;
      margin-top: 30px;
      color: #FFD700;
      opacity: 0.7;
      font-size: 0.8rem;
      letter-spacing: 2px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⚡ RELENTLESS BILLIONAIRE ⚡</h1>
      <p class="subtitle">ELITE AUTONOMOUS AGENT v2.0</p>
    </div>

    <div class="stats">
      <div class="stat">
        <h3>AGENT STATUS</h3>
        <p id="agent-status">LOADING...</p>
      </div>
      <div class="stat">
        <h3>ML ENGINE</h3>
        <p id="ml-status">4 MODELS</p>
      </div>
      <div class="stat">
        <h3>RL ENGINE</h3>
        <p id="rl-status">READY</p>
      </div>
      <div class="stat">
        <h3>DEPLOYMENT</h3>
        <p id="deploy-status">CLOUDFLARE</p>
      </div>
    </div>

    <div class="controls">
      <button class="btn" onclick="checkStatus()">📊 STATUS</button>
      <button class="btn" onclick="triggerAnalyze()">🔍 ANALYZE</button>
      <button class="btn" onclick="askAI()">🤖 AI QUERY</button>
      <button class="btn" onclick="checkHealth()">💚 HEALTH</button>
    </div>

    <div class="status-box">
      <h4>SYSTEM OUTPUT:</h4>
      <div id="output" class="loading">Initializing system...</div>
    </div>

    <footer>
      🌐 Powered by Cloudflare Workers | AI Engine: Llama 3.8B<br>
      Status last updated: <span id="timestamp">--:--:--</span>
    </footer>
  </div>

  <script>
    const outputDiv = document.getElementById('output');
    const timestampSpan = document.getElementById('timestamp');

    function updateTimestamp() {
      const now = new Date();
      timestampSpan.textContent = now.toLocaleTimeString();
    }

    function formatJSON(obj) {
      return JSON.stringify(obj, null, 2);
    }

    async function checkStatus() {
      outputDiv.innerHTML = '<span class="loading">Checking agent status...</span>';
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        outputDiv.innerHTML = `<span class="success">✓ Status Retrieved:\n${formatJSON(data)}</span>`;
        document.getElementById('agent-status').textContent = data.status?.toUpperCase() || 'ACTIVE';
        updateTimestamp();
      } catch (e) {
        outputDiv.innerHTML = `<span class="error">✗ Error: ${e.message}</span>`;
      }
    }

    async function triggerAnalyze() {
      outputDiv.innerHTML = '<span class="loading">Triggering analysis...</span>';
      try {
        const res = await fetch('/api/analyze');
        const data = await res.json();
        outputDiv.innerHTML = `<span class="success">✓ Analysis Queued:\n${formatJSON(data)}</span>`;
        updateTimestamp();
      } catch (e) {
        outputDiv.innerHTML = `<span class="error">✗ Error: ${e.message}</span>`;
      }
    }

    async function askAI() {
      outputDiv.innerHTML = '<span class="loading">Querying AI engine...</span>';
      try {
        const query = encodeURIComponent('Analyze the Relentless Billionaire system and provide status');
        const res = await fetch('/api/ai?q=' + query);
        const data = await res.json();
        outputDiv.innerHTML = `<span class="success">✓ AI Response:\n${formatJSON(data)}</span>`;
        updateTimestamp();
      } catch (e) {
        outputDiv.innerHTML = `<span class="error">✗ Error: ${e.message}</span>`;
      }
    }

    async function checkHealth() {
      outputDiv.innerHTML = '<span class="loading">Checking system health...</span>';
      try {
        const res = await fetch('/api/health');
        const data = await res.json();
        outputDiv.innerHTML = `<span class="success">✓ System Health:\n${formatJSON(data)}</span>`;
        updateTimestamp();
      } catch (e) {
        outputDiv.innerHTML = `<span class="error">✗ Error: ${e.message}</span>`;
      }
    }

    // Initial status check
    window.addEventListener('load', checkStatus);
  </script>
</body>
</html>`;
}
