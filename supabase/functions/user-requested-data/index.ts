/**
 * user-requested-data: the app's browsers hand in data they fetched from an
 * outside source because a user asked for something, and this keeps it in
 * user_requested_data (migration 009) for concert-database
 * (concertdb/msm_requested.py). Nothing kept is about the user.
 *
 * POST { source, data } → 204, or 400 with a reason. Each source's check
 * (_shared/userRequestedData.ts, BROWSER_SOURCES) keeps only the fields
 * concert-database reads; a row's version is a hash of what's kept, so seq
 * moves forward only when the data changes.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requestedRow } from "../_shared/userRequestedData.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const MAX_BODY = 256 * 1024;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function reply(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return reply(204);
  if (req.method !== "POST") return reply(405, { error: "POST only" });
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return reply(413, { error: "too large" });
    let row;
    try {
      row = requestedRow(JSON.parse(text));
    } catch (e) {
      return reply(400, { error: e instanceof Error ? e.message : "bad request" });
    }
    const { error } = await supabase.from("user_requested_data").upsert({
      ...row,
      version: await sha256(JSON.stringify(row.data)),
      fetched_at: new Date().toISOString(),
    }, { onConflict: "source,key" });
    if (error) throw new Error(error.message);
    return reply(204);
  } catch (e) {
    console.error("user-requested-data:", e instanceof Error ? e.message : e);
    return reply(500, { error: "not kept" });
  }
});
