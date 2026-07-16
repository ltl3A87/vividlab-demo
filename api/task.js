const ARK_URL = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/";
const ALLOWED_ORIGIN = "https://ltl3a87.github.io";

function cors(res, origin) {
  res.setHeader("Access-Control-Allow-Origin", origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

export default async function handler(req, res) {
  cors(res, req.headers.origin);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (req.headers.origin && req.headers.origin !== ALLOWED_ORIGIN) return res.status(403).json({ error: "Origin not allowed" });
  if (!process.env.ARK_API_KEY) return res.status(503).json({ error: "ARK_API_KEY is not configured" });
  const id = String(req.query.id || "");
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(id)) return res.status(400).json({ error: "Invalid task id" });

  try {
    const arkResponse = await fetch(ARK_URL + encodeURIComponent(id), {
      headers: { Authorization: "Bearer " + process.env.ARK_API_KEY }
    });
    const data = await arkResponse.json().catch(() => ({ error: "Invalid Ark response" }));
    return res.status(arkResponse.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Task lookup failed" });
  }
}
