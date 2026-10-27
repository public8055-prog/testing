import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import type { Socket } from "node:net";

test("expired browser access renews through the shared session and establishes an authenticated WebSocket", async ({ page, baseURL }) => {
  const response = await page.request.post("/api/auth/register", { headers: { Origin: baseURL! }, data: { name: "QA Session Renewal", email: `renewal-${randomUUID()}@example.test`, password: `QA-${randomUUID()}!`, termsAccepted: true, privacyConsent: true, adultConfirmed: true } });
  expect(response.status(), await response.text()).toBe(201);
  const before = await page.context().cookies();
  const originalRefresh = before.find(cookie => cookie.name === "urbankare_refresh")!;
  expect(originalRefresh.httpOnly).toBe(true);
  await page.context().clearCookies({ name: "urbankare_session" });
  let ready = false;
  page.on("websocket", socket => { if(socket.url().endsWith("/api/live"))socket.on("framereceived", frame => { if(String(frame.payload).includes('"type":"ready"'))ready=true; }); });
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect.poll(()=>ready).toBe(true);
  const after = await page.context().cookies();
  expect(after.some(cookie => cookie.name === "urbankare_session" && cookie.httpOnly)).toBe(true);
  expect(after.find(cookie => cookie.name === "urbankare_refresh")!.value === originalRefresh.value).toBe(false);
  expect(await page.evaluate(() => document.cookie.includes("urbankare_session") || document.cookie.includes("urbankare_refresh"))).toBe(false);
  const wsUrl = baseURL!.replace(/^http/, "ws") + "/api/live";
  const cookie = after.map(value => `${value.name}=${value.value}`).join("; ");
  const rejected = (origin: string, credentials = "") => new Promise<number>((resolve, reject) => {
    const client = new WebSocket(wsUrl, { origin, headers: { Cookie: credentials }, handshakeTimeout: 10000 });
    client.on("error", reject);
    client.once("open", () => { client.close(); reject(new Error("Unexpected WebSocket authorization success")); });
    client.once("unexpected-response", (_request, response) => { response.resume(); resolve(response.statusCode || 0); client.terminate(); });
  });
  expect(await rejected("https://untrusted.example.test", cookie)).toBe(403);
  expect(await rejected(baseURL!)).toBe(401);
  await new Promise<void>((resolve, reject) => {
    const client = new WebSocket(wsUrl, { origin: baseURL!, headers: { Cookie: cookie }, handshakeTimeout: 10000 });
    const timeout = setTimeout(() => { client.terminate(); reject(new Error("Invalid WebSocket frame was not rejected")); }, 10000);
    client.on("error", () => undefined);
    client.once("open", () => { (client as unknown as { _socket: Socket })._socket.write(Buffer.from([0x81, 0x01, 0x61])); });
    client.once("close", () => { clearTimeout(timeout); resolve(); });
  });
  expect((await page.request.get("/api/health")).status()).toBe(200);
  expect((await page.request.get("/api/auth/me")).ok()).toBe(true);
  expect((await page.request.get("/api/admin/users")).status()).toBe(404);
});

test("mobile and tablet navigation remain reachable, dark mode is accessible, and keyboard resize hides the bottom tabs", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/login");
  const navigation = page.getByRole("navigation", { name: "Primary mobile navigation", exact: true });
  await expect(navigation).toBeVisible();
  await page.getByRole("button", { name: "Switch to dark mode", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  await info.attach("dark-login-axe.json", { body: JSON.stringify(results.violations), contentType: "application/json" });
  expect(results.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([]);
  await page.screenshot({ path: info.outputPath("dark-login-320.png"), fullPage: true });
  await page.getByLabel("Password", { exact: true }).focus();
  // Desktop engines do not display a virtual keyboard: exercise the visualViewport
  // resize signal explicitly while a real editable element owns focus.
  await page.evaluate(() => { Object.defineProperty(window.visualViewport!, "height", { configurable: true, value: 420 }); window.visualViewport!.dispatchEvent(new Event("resize")); });
  await expect(navigation).toBeHidden();
  await page.getByRole("heading", { level: 1 }).click();
  await page.evaluate(() => { delete (window.visualViewport as unknown as Record<string, unknown>).height; window.visualViewport!.dispatchEvent(new Event("resize")); });
  await expect(navigation).toBeVisible();
  for (const width of [768, 960, 1023]) { await page.setViewportSize({ width, height: 900 }); await expect(navigation).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1); }
  await page.setViewportSize({ width: 1280, height: 900 }); await expect(navigation).toBeHidden();
  await page.reload(); await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("cached catalogue responses meet the local latency target and the API enforces its actual global limit", async ({ request }, info) => {
  test.skip(process.env.E2E_ISOLATED_CLIENT_IPS !== "1", "The burst needs a dedicated local QA client so it cannot throttle another user.");
  const latencies: number[] = [];
  for (let index = 0; index < 75; index++) {
    const started = performance.now();
    const response = await request.get(index % 2 ? "/api/categories" : "/api/services");
    expect(response.status()).toBe(200);
    await response.body();
    if (index >= 15) latencies.push(performance.now() - started);
  }
  const ordered = latencies.toSorted((a, b) => a - b), p95 = ordered[Math.ceil(ordered.length * 0.95) - 1];
  await info.attach("cached-read-latency.json", { contentType: "application/json", body: JSON.stringify({ environment: "Local standalone gateway; sequential warm requests; includes HTTP and test client overhead", samples: ordered.length, p95Ms: p95, targetMs: 300, minimumMs: ordered[0], maximumMs: ordered.at(-1) }, null, 2) });
  expect(p95, "Cached API p95 on this machine").toBeLessThan(300);
  for (let index = 75; index < 100; index++) expect((await request.get("/api/categories")).status()).toBe(200);
  const limited = await request.get("/api/categories");
  expect(limited.status()).toBe(429); expect(Number(limited.headers()["retry-after"])).toBeGreaterThan(0);
});
