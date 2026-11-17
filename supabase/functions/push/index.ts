// No Brand Baseball - push notifications.
// Called by the database trigger in supabase/push_webhook.sql on every new message and every video upload/review.
// Sends through Apple Push Notification service (token auth, no Firebase). Android devices are skipped until
// Firebase is set up for the Play build.
//
// Function secrets (set by the "Supabase - deploy" workflow):
//   PUSH_SECRET     shared with the trigger (x-push-secret header)
//   APNS_KEY        the .p8 key text (Apple Developer -> Keys -> Apple Push Notifications service)
//   APNS_KEY_ID     its Key ID            APNS_TEAM_ID  the Apple team id
//   APNS_TOPIC      bundle id (default com.nobrandbaseball.app)
//   APNS_HOST       default https://api.push.apple.com (TestFlight/App Store); api.sandbox.push.apple.com for Xcode builds
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SECRET = Deno.env.get("PUSH_SECRET") ?? "";
const APNS = {
  host: Deno.env.get("APNS_HOST") ?? "https://api.push.apple.com",
  keyId: Deno.env.get("APNS_KEY_ID") ?? "",
  teamId: Deno.env.get("APNS_TEAM_ID") ?? "",
  key: Deno.env.get("APNS_KEY") ?? "",
  topic: Deno.env.get("APNS_TOPIC") ?? "com.nobrandbaseball.app",
};

type Row = Record<string, any>;
interface Payload { type: "INSERT" | "UPDATE" | "DELETE"; table: string; record: Row; old_record?: Row | null }
interface Note { title: string; body: string; hash: string }

// ---------- APNs token (ES256 JWT, cached for 40 minutes; Apple accepts up to 60) ----------
let cached: { token: string; at: number } | null = null;
const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b);
  let s = ""; for (const c of bytes) s += String.fromCharCode(c);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
async function apnsJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && now - cached.at < 2400) return cached.token;
  const pem = APNS.key.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64url(JSON.stringify({ alg: "ES256", kid: APNS.keyId }));
  const claims = b64url(JSON.stringify({ iss: APNS.teamId, iat: now }));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${head}.${claims}`));
  cached = { token: `${head}.${claims}.${b64url(sig)}`, at: now };
  return cached.token;
}

async function sendApns(token: string, note: Note): Promise<"ok" | "gone" | "error"> {
  const r = await fetch(`${APNS.host}/3/device/${token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${await apnsJwt()}`,
      "apns-topic": APNS.topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
    },
    body: JSON.stringify({ aps: { alert: { title: note.title, body: note.body }, sound: "default" }, hash: note.hash }),
  });
  if (r.ok) return "ok";
  const text = await r.text();
  console.warn(`APNs ${r.status} for ${token.slice(0, 8)}…: ${text}`);
  if (r.status === 410 || /BadDeviceToken|Unregistered|DeviceTokenNotForTopic/.test(text)) return "gone";
  return "error";
}

// ---------- who gets what ----------
const trim = (s: unknown, n = 160) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const first = (name: unknown) => String(name ?? "").trim().split(" ")[0] || "Your pitcher";

async function pitcherName(pitcherId: string): Promise<string> {
  const { data } = await sb.from("profiles").select("display_name").eq("pitcher_id", pitcherId).maybeSingle();
  return data?.display_name || pitcherId;
}
async function devicesForPitcher(pitcherId: string) {
  const { data: prof } = await sb.from("profiles").select("user_id").eq("pitcher_id", pitcherId).maybeSingle();
  if (!prof) return [];
  const { data } = await sb.from("devices").select("token, platform").eq("user_id", prof.user_id);
  return data ?? [];
}
async function devicesForCoaches(exceptUserId?: string) {
  const { data: coaches } = await sb.from("profiles").select("user_id").eq("role", "coach");
  const ids = (coaches ?? []).map((c) => c.user_id).filter((id) => id !== exceptUserId);
  if (!ids.length) return [];
  const { data } = await sb.from("devices").select("token, platform").in("user_id", ids);
  return data ?? [];
}

async function plan(p: Payload): Promise<{ note: Note; devices: { token: string; platform: string }[] } | null> {
  const r = p.record;
  if (p.table === "messages" && p.type === "INSERT") {
    if (r.sender_role === "coach") {
      return {
        note: { title: r.sender_name || "Your coach", body: trim(r.body), hash: "#/home" },
        devices: await devicesForPitcher(r.pitcher_id),
      };
    }
    const name = await pitcherName(r.pitcher_id);
    return {
      note: { title: `${name}: new message`, body: trim(r.body), hash: `#/coach/${encodeURIComponent(r.pitcher_id)}` },
      devices: await devicesForCoaches(),
    };
  }
  if (p.table === "assessments" && p.type === "INSERT") {
    if (r.uploaded_by_role === "coach") {
      return {
        note: { title: `${r.uploaded_by_name || "Your coach"} saved a video to your page`, body: trim(r.note) || "Open the app to watch it.", hash: "#/home" },
        devices: await devicesForPitcher(r.pitcher_id),
      };
    }
    const name = await pitcherName(r.pitcher_id);
    return {
      note: { title: `${name} sent a video`, body: trim(r.note) || "Tap to review it.", hash: `#/coach/${encodeURIComponent(r.pitcher_id)}` },
      devices: await devicesForCoaches(r.user_id),
    };
  }
  if (p.table === "assessments" && p.type === "UPDATE") {
    const o = p.old_record ?? {};
    const reviewedNow = !o.reviewed_at && r.reviewed_at;
    const noteChanged = (r.coach_note || "") !== (o.coach_note || "") && r.coach_note;
    if (!reviewedNow && !noteChanged) return null;
    return {
      note: { title: reviewedNow ? "Your video was reviewed" : "New note on your video", body: trim(r.coach_note) || "Open the app to see the review.", hash: "#/home" },
      devices: await devicesForPitcher(r.pitcher_id),
    };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("push: POST only", { status: 405 });
  if (!SECRET || req.headers.get("x-push-secret") !== SECRET) return new Response("forbidden", { status: 403 });
  let payload: Payload;
  try { payload = await req.json(); } catch { return new Response("bad json", { status: 400 }); }

  const todo = await plan(payload);
  if (!todo) return Response.json({ sent: 0, reason: "nothing to notify" });
  if (!APNS.key || !APNS.keyId || !APNS.teamId) return Response.json({ sent: 0, reason: "APNs not configured" }, { status: 200 });

  let sent = 0, gone = 0, skipped = 0;
  for (const d of todo.devices) {
    if (d.platform !== "ios") { skipped++; continue; } // Android: needs Firebase, not set up yet
    const res = await sendApns(d.token, todo.note);
    if (res === "ok") sent++;
    else if (res === "gone") { gone++; await sb.from("devices").delete().eq("token", d.token); }
  }
  console.log(`push: "${todo.note.title}" -> sent ${sent}, removed ${gone}, skipped ${skipped}`);
  return Response.json({ sent, removed: gone, skipped });
});
