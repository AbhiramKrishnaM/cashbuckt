import { connection } from "next/server";
import { getPool } from "@/lib/db";
import { checkHealth } from "@/lib/health";

export async function GET() {
  await connection(); // always run at request time, never prerender
  const { httpStatus, body } = await checkHealth(getPool);
  return Response.json(body, {
    status: httpStatus,
    headers: { "Cache-Control": "no-store" },
  });
}
