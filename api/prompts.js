import { put } from "@vercel/blob";

const ARK_URL = "https://ark.cn-beijing.volces.com/api/v3/responses";
const MODEL = "doubao-seed-2-0-lite-260215";
const ALLOWED_ORIGIN = "https://ltl3a87.github.io";

function cors(res, origin) {
  res.setHeader("Access-Control-Allow-Origin", origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

function extractText(value) {
  if (typeof value?.output_text === "string") return value.output_text;
  if (value && typeof value === "object") {
    if ((value.type === "output_text" || value.type === "text") && typeof value.text === "string") return value.text;
    for (const child of Object.values(value)) {
      const text = extractText(child);
      if (text) return text;
    }
  }
  return "";
}

function parseIdeas(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const parsed = JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned);
  if (!Array.isArray(parsed.ideas)) throw new Error("The vision model did not return an ideas array");
  return parsed.ideas.slice(0, 10).map((idea, index) => ({
    title: String(idea?.title || `创意 ${index + 1}`).slice(0, 60),
    hook: String(idea?.hook || "").slice(0, 160),
    prompt: String(idea?.prompt || "").slice(0, 5000)
  })).filter(idea => idea.prompt.length >= 20);
}

export default async function handler(req, res) {
  cors(res, req.headers.origin);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (req.headers.origin && req.headers.origin !== ALLOWED_ORIGIN) return res.status(403).json({ error: "Origin not allowed" });
  if (!process.env.ARK_API_KEY) return res.status(503).json({ error: "ARK_API_KEY is not configured" });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(503).json({ error: "Blob storage is not configured" });

  try {
    const images = (Array.isArray(req.body?.imageDataUrls) ? req.body.imageDataUrls : []).filter(Boolean).slice(0, 4);
    const category = String(req.body?.category || "抖音带货").slice(0, 40);
    const duration = Math.min(15, Math.max(5, Number(req.body?.duration) || 15));
    const ratio = ["9:16", "16:9", "1:1"].includes(req.body?.ratio) ? req.body.ratio : "9:16";
    if (!images.length) return res.status(400).json({ error: "Upload at least one reference image first" });

    const blobs = [];
    for (const input of images) {
      const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(input);
      if (!match) return res.status(400).json({ error: "References must be JPEG, PNG, or WebP images" });
      const bytes = Buffer.from(match[2], "base64");
      if (!bytes.length || bytes.length > 1024 * 1024) return res.status(413).json({ error: "Each analysis image must be smaller than 1 MB" });
      const ext = match[1].split("/")[1].replace("jpeg", "jpg");
      blobs.push(await put("prompt-references/" + crypto.randomUUID() + "." + ext, bytes, {
        access: "public",
        contentType: match[1],
        addRandomSuffix: true
      }));
    }

    const instruction = `你是短视频广告导演和 Seedance 2.0 提示词专家。分析用户上传的 ${blobs.length} 张参考图，它们属于同一创作项目。为“${category}”生成 10 个差异显著、可拍摄、真实、有剧情的 ${duration} 秒 ${ratio} 视频方案。

要求：
1. 先准确识别商品/主体的外观、材质、颜色、图案、用途和图片之间的关系；无法从图片确认的品牌授权、正品、价格、功效或参数不得杜撰。
2. 10 个方案必须有不同的故事钩子和场景组合，例如生活冲突、朋友对话、挑战、反转、使用前后、第一视角、轻喜剧、情绪故事、街头采访、视觉奇观；但都必须能在 ${duration} 秒内讲清楚。
3. 每个完整 prompt 都要按时间拆分镜头，包含开场钩子、人物动作/对白、商品特写、真实环境、运镜、声音、结尾行动号召，以及保持参考主体一致的约束。
4. 不要生成参考图里的水印、二维码、账号名或排版文字；不要新增商标；如果图片包含疑似第三方标识，只描述可见外观，不做官方或授权承诺。
5. 输出必须是严格 JSON，不要 Markdown，不要解释，格式为：
{"ideas":[{"title":"8-16字标题","hook":"一句话故事钩子","prompt":"可直接交给 Seedance 的完整中文分镜提示词"}]}
必须正好输出 10 个 ideas。`;

    const arkResponse = await fetch(ARK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + process.env.ARK_API_KEY
      },
      body: JSON.stringify({
        model: MODEL,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: instruction },
            ...blobs.map(blob => ({ type: "input_image", image_url: blob.url }))
          ]
        }],
        thinking: { type: "disabled" },
        max_output_tokens: 12000
      })
    });
    const data = await arkResponse.json().catch(() => ({ error: "Invalid Ark response" }));
    if (!arkResponse.ok) return res.status(arkResponse.status).json(data);
    const ideas = parseIdeas(extractText(data));
    if (!ideas.length) return res.status(502).json({ error: "No usable prompt ideas were returned" });
    return res.status(200).json({ ideas });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Prompt generation failed" });
  }
}
