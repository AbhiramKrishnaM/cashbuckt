import { loadClassifyConfig } from "@/lib/config";
import { getPool } from "@/lib/db";
import { requireEnv } from "@/lib/env";
import { ingestSms } from "@/lib/ingest";
import { smsHash } from "@/lib/sms/normalize";
import { secretMatches } from "@/lib/webhook-auth";

const MAX_BODY_BYTES = 4 * 1024;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Bank-SMS webhook for the iOS Shortcuts automations (spec: sms-ingestion).
 * Never logs SMS text: only the outcome and the first 8 hex chars of its hash.
 */
export async function POST(request: Request) {
  if (!secretMatches(request.headers.get("x-webhook-secret"), requireEnv("WEBHOOK_SECRET"))) {
    return new Response(null, { status: 401 });
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);

  let sms: unknown;
  try {
    sms = (JSON.parse(text) as { sms?: unknown } | null)?.sms;
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (typeof sms !== "string" || sms.trim() === "") return json({ error: "invalid_body" }, 400);

  const tag = smsHash(sms).slice(0, 8);
  try {
    const result = await ingestSms(getPool(), sms, loadClassifyConfig());
    console.info(
      `[ingest] ${result.status}${result.status === "saved" ? ` ${result.channel} ${result.month}` : ""} sms=${tag}`,
    );
    if (result.status === "saved") {
      return json({
        status: "saved",
        id: result.id,
        month: result.month,
        channel: result.channel,
        needs_note: result.needsNote,
      });
    }
    return json(result);
  } catch (err) {
    console.error(`[ingest] storage_failed sms=${tag}: ${(err as Error).message}`);
    return json({ error: "storage_failed" }, 500);
  }
}
