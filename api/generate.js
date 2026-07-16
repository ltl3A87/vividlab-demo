import { put } from "@vercel/blob";

const ARK_URL = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks";
const MODEL = "doubao-seedance-2-0-260128";
const ALLOWED_ORIGIN = "https://ltl3a87.github.io";

function cors(res, origin) {
  res.setHeader("Access-Control-Allow-Origin", origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

export default async function handler(req, res) {
  cors(res, req.headers.origin);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (req.headers.origin && req.headers.origin !== ALLOWED_ORIGIN) return res.status(403).json({ error: "Origin not allowed" });
  if (!process.env.ARK_API_KEY) return res.status(503).json({ error: "ARK_API_KEY is not configured" });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(503).json({ error: "Blob storage is not configured" });

  try {
    const { prompt, imageDataUrl, imageDataUrls, ratio = "9:16", duration = 15 } = req.body || {};
    if (typeof prompt !== "string" || prompt.trim().length < 10 || prompt.length > 5000) {
      return res.status(400).json({ error: "Prompt must be 10-5000 characters" });
    }
    const inputs = (Array.isArray(imageDataUrls) ? imageDataUrls : [imageDataUrl]).filter(Boolean).slice(0, 4);
    if (!inputs.length) return res.status(400).json({ error: "At least one reference image is required" });
    const safeRatio = ["9:16", "16:9", "1:1"].includes(ratio) ? ratio : "9:16";
    const safeDuration = Math.min(15, Math.max(4, Number(duration) || 15));
    const blobs = [];
    for (const input of inputs) {
      const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(input);
      if (!match) return res.status(400).json({ error: "References must be JPEG, PNG, or WebP images" });
      const bytes = Buffer.from(match[2], "base64");
      if (!bytes.length || bytes.length > 4 * 1024 * 1024) return res.status(413).json({ error: "Each image must be smaller than 4 MB" });
      const ext = match[1].split("/")[1].replace("jpeg", "jpg");
      blobs.push(await put("references/" + crypto.randomUUID() + "." + ext, bytes, {
        access: "public",
        contentType: match[1],
        addRandomSuffix: true
      }));
    }

    const arkResponse = await fetch(ARK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + process.env.ARK_API_KEY
      },
      body: JSON.stringify({
        model: MODEL,
        content: [
          { type: "text", text: prompt.trim() },
          ...blobs.map(blob => ({ type: "image_url", image_url: { url: blob.url }, role: "reference_image" }))
        ],
        generate_audio: true,
        ratio: safeRatio,
        duration: safeDuration,
        watermark: false
      })
    });
    const data = await arkResponse.json().catch(() => ({ error: "Invalid Ark response" }));
    return res.status(arkResponse.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Generation request failed" });
  }
}
