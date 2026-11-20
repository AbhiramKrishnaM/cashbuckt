import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/log-transaction/route";
import { closePool } from "@/lib/db";
import { NOISE_FIXTURES, TXN_FIXTURES } from "../fixtures/sms";
import { closeTestPool, testDatabaseUrl, testPool, truncateAll } from "../helpers/db";

const SECRET = "test-webhook-secret-0123456789";
const ICICI_UPI = TXN_FIXTURES.find((f) => f.name === "ICICI UPI debit (MOMO WANG)")!.sms;
const URL_ = "http://localhost/api/log-transaction";

function req(body: string, headers: Record<string, string> = { "x-webhook-secret": SECRET }) {
  return new Request(URL_, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
}

const send = (sms: string) => POST(req(JSON.stringify({ sms })));

async function storedRows(): Promise<number> {
  const { rows } = await testPool().query(
    "SELECT (SELECT count(*) FROM transactions) + (SELECT count(*) FROM unparsed_sms) AS n",
  );
  return Number(rows[0].n);
}

const originalEnv = { ...process.env };

beforeAll(() => {
  process.env.DATABASE_URL = testDatabaseUrl();
  process.env.WEBHOOK_SECRET = SECRET;
  process.env.OWNER_NAME_PATTERNS = "";
});

beforeEach(async () => {
  await truncateAll();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(truncateAll);

afterAll(async () => {
  await closePool();
  await closeTestPool();
  process.env = originalEnv;
});

describe("authentication", () => {
  it("401 without the secret, nothing stored", async () => {
    const res = await POST(req(JSON.stringify({ sms: ICICI_UPI }), {}));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("");
    expect(await storedRows()).toBe(0);
  });

  it("401 with a wrong secret", async () => {
    const res = await POST(req(JSON.stringify({ sms: ICICI_UPI }), { "x-webhook-secret": "wrong" }));
    expect(res.status).toBe(401);
    expect(await storedRows()).toBe(0);
  });
});

describe("request validation", () => {
  it.each([
    ["missing sms field", JSON.stringify({ text: "hello" })],
    ["not JSON", "sms=hello"],
    ["sms not a string", JSON.stringify({ sms: 42 })],
    ["blank sms", JSON.stringify({ sms: "   " })],
    ["null body", "null"],
  ])("400 for %s", async (_name, body) => {
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
  });

  it("413 for a 10 KB body, nothing stored", async () => {
    const res = await send("Rs 1 debited ".repeat(800));
    expect(res.status).toBe(413);
    expect(await storedRows()).toBe(0);
  });
});

describe("responses", () => {
  it("200 saved for the ICICI UPI debit", async () => {
    const res = await send(ICICI_UPI);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "saved", month: "2026-11", channel: "UPI", needs_note: true });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("200 duplicate on re-send", async () => {
    const first = await (await send(ICICI_UPI)).json();
    const second = await (await send(ICICI_UPI)).json();
    expect(second).toEqual({ status: "duplicate", id: first.id });
  });

  it("200 ignored for the IDFC reminder", async () => {
    const res = await send(NOISE_FIXTURES[0].sms);
    expect(await res.json()).toEqual({ status: "ignored" });
  });

  it("never logs SMS text", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await send(ICICI_UPI);
    const logged = info.mock.calls.flat().join(" ");
    expect(logged).toContain("[ingest] saved UPI 2026-11");
    expect(logged).not.toContain("MOMO");
    expect(logged).not.toContain("370");
  });
});

describe("storage failure", () => {
  it("500 storage_failed within 3 s when the DB is unreachable, no details leaked", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await closePool();
    process.env.DATABASE_URL = "postgres://cashbuckt:hunter2-secret@127.0.0.1:1/cashbuckt";
    try {
      const started = Date.now();
      const res = await send(ICICI_UPI);
      expect(Date.now() - started).toBeLessThan(3000);
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ error: "storage_failed" });
      expect(text).not.toContain("hunter2");
      expect(err.mock.calls.flat().join(" ")).not.toContain("MOMO");
    } finally {
      await closePool();
      process.env.DATABASE_URL = testDatabaseUrl();
    }
  });
});
