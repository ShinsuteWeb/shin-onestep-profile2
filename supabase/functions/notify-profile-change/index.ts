const SITE_ORIGIN = "https://shinsuteweb.github.io";
const corsHeaders = {
  "Access-Control-Allow-Origin": SITE_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-editor-password",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const requests = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });
  if (request.headers.get("origin") !== SITE_ORIGIN) return json(403, { error: "Origin not allowed" });

  const expectedPassword = Deno.env.get("PROFILE_EDIT_PASSWORD");
  if (!expectedPassword || request.headers.get("x-editor-password") !== expectedPassword) {
    return json(401, { error: "Unauthorized" });
  }

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const recipient = Deno.env.get("NOTIFY_TO_EMAIL");
  const sender = Deno.env.get("NOTIFY_FROM_EMAIL");
  if (!apiKey || !recipient || !sender) return json(503, { error: "Email service is not configured" });

  const ip = (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  if (ip) {
    const now = Date.now();
    const recent = (requests.get(ip) || []).filter((time) => now - time < WINDOW_MS);
    if (recent.length >= MAX_PER_WINDOW) return json(429, { error: "Too many requests" });
    recent.push(now);
    requests.set(ip, recent);
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: sender,
        to: [recipient],
        subject: "プロフィールが更新されました",
        text: "サイトでプロフィールが保存されました（プロフィール内容または画像の変更）。",
      }),
    });
    if (!response.ok) {
      console.error("Resend rejected notification:", response.status);
      return json(502, { error: "Email could not be sent" });
    }
    return json(200, { sent: true });
  } catch (error) {
    console.error("Notification delivery failed:", error);
    return json(502, { error: "Email could not be sent" });
  }
});
