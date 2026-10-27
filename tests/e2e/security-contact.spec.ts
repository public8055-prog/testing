import { test, expect } from "./fixtures";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
test("production headers, private routes, consent and contact inbox resist cross-origin and script injection", async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  test.skip(!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname), "Trusted fixture is local only.");
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  test.skip(!/^mongodb:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(process.env.MONGODB_URI || ""), "Local Mongo fixture only.");
  const { bootstrapAdministrator } = await import("../../lib/admin-bootstrap"), { getMongoDb, closeMongo } = await import("../../lib/mongo"), { closeRedis } = await import("../../lib/redis");
  const db = await getMongoDb(), stamp = randomUUID(), alias = `security-${stamp}#example.test`, password = `QA-${randomUUID()}!`;
  let adminId = "";
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  try {
    // strict-dynamic deliberately trusts script elements created by trusted JS.
    // Model an HTML injection instead: the browser parser sees an unnonced script
    // in the real document, under the unchanged server-provided CSP header.
    const homeUrl = new URL("/", baseURL).href;
    let probeInserted = false;
    await page.route(homeUrl, async route => {
      const response = await route.fetch(), html = await response.text();
      expect(html).toContain("</head>");
      probeInserted = true;
      await route.fulfill({ response, body: html.replace("</head>", '<script>window.__injectedScriptRan = true</script></head>') });
    }, { times: 1 });
    const home = await page.goto("/"); const headers = home!.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff"); expect(headers["x-frame-options"]).toBe("DENY"); expect(headers["x-powered-by"]).toBeUndefined();
    expect(headers["content-security-policy"]).toContain("'nonce-"); expect(headers["content-security-policy"]).toContain("'strict-dynamic'"); expect(headers["content-security-policy"]).not.toContain("'unsafe-eval'");
    expect(probeInserted).toBe(true);
    expect(await page.evaluate(() => (window as Window & { __injectedScriptRan?: boolean }).__injectedScriptRan)).toBeUndefined();
    for (const path of ["/.env", "/.env.local", "/.git/config", "/.data/urbankare.sqlite", "/artifacts/security-audit.json", "/package.json", "/next.config.ts", "/docker-compose.yml", "/tsconfig.json"]) expect((await page.request.get(path)).status(), path).toBe(404);
    expect((await page.request.get("/api/admin/contact")).status()).toBe(404);
    expect((await page.request.post("/api/contact", { headers: { Origin: "https://attacker.example" }, data: {} })).status()).toBe(403);
    const preflight = await page.request.fetch("/api/contact", { method: "OPTIONS", headers: { Origin: "https://attacker.example", "Access-Control-Request-Method": "POST" } }); expect(preflight.headers()["access-control-allow-origin"]).toBeUndefined();
    const payload = { name: "QA Privacy Contact", email: `privacy-${stamp}@example.test`, subject: `Privacy ${stamp}`, message: '<img src=x onerror="window.__storedInjection=true"> Please provide a copy of my account information.', consent: true, website: "" };
    expect((await page.request.post("/api/contact", { headers: { Origin: baseURL! }, data: { ...payload, consent: false } })).status()).toBe(400);
    await page.goto("/contact"); await page.getByLabel("Your name", { exact: true }).fill(payload.name); await page.getByLabel("Reply email", { exact: true }).fill(payload.email); await page.getByLabel("Subject", { exact: true }).fill(payload.subject); await page.getByLabel("How can we help?", { exact: true }).fill(payload.message); await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Send support request", exact: true }).click(); await expect(page.getByRole("status")).toContainText("UK-HELP-");
    await expect(page.getByRole("link", { name: "Message support on WhatsApp", exact: true })).toHaveAttribute("href", /^https:\/\/wa\.me\/919717621336\?/);
    adminId = (await bootstrapAdministrator(alias, password, "QA Privacy Administrator")).id;
    await page.goto("/login"); await page.getByLabel("Email or login ID", { exact: true }).fill(alias); await page.getByLabel("Password", { exact: true }).fill(password);
    const capturedLogins: { body: Record<string, unknown> & { user: { role: string } }; headers: { name: string; value: string }[] }[] = [];
    await page.route(new URL("/api/auth/login", baseURL).href, async route => {
      // Keep the real upstream response available before successful sign-in
      // replaces the document and Chromium releases its response body.
      const response = await route.fetch();
      capturedLogins.push({ body: await response.json(), headers: response.headersArray() });
      await route.fulfill({ response });
    }, { times: 1 });
    const signedIn = page.waitForResponse(response => response.url().endsWith("/api/auth/login") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const loginResponse = await signedIn; expect(loginResponse.status()).toBe(200);
    expect(capturedLogins.length).toBe(1);
    const loginBody = capturedLogins[0].body; expect(loginBody.user.role).toBe("SUPER_ADMIN"); expect("accessToken" in loginBody, "Access credentials stay out of response JSON").toBe(false); expect("refreshToken" in loginBody, "Refresh credentials stay out of response JSON").toBe(false);
    const cookieHeaders = capturedLogins[0].headers.filter(header => header.name.toLowerCase() === "set-cookie").map(header => header.value);
    for (const [name, maxAge] of [["urbankare_session", 900], ["urbankare_refresh", 604800]] as const) {
      const cookie = cookieHeaders.find(value => value.startsWith(`${name}=`)) || "";
      // Boolean assertions keep credential values out of failure diagnostics.
      expect(Boolean(cookie), `${name} is issued`).toBe(true);
      expect(/;\s*HttpOnly(?:;|$)/i.test(cookie), `${name} is HttpOnly`).toBe(true);
      expect(/;\s*SameSite=Lax(?:;|$)/i.test(cookie), `${name} sends SameSite=Lax`).toBe(true);
      expect(/;\s*Path=\/(?:;|$)/i.test(cookie), `${name} has root path`).toBe(true);
      const lifetime = Number(cookie.match(/;\s*Max-Age=(\d+)(?:;|$)/i)?.[1]);
      expect(lifetime, `${name} has the required lifetime`).toBeLessThanOrEqual(maxAge);
      expect(lifetime, `${name} retains its configured lifetime`).toBeGreaterThanOrEqual(maxAge - (name === "urbankare_refresh" ? 60 : 0));
      if (process.env.COOKIE_SECURE === "true" || new URL(baseURL!).protocol === "https:") expect(/;\s*Secure(?:;|$)/i.test(cookie), `${name} is Secure`).toBe(true);
    }
    await expect(page).toHaveURL(/\/admin\/dashboard$/);
    await page.goto("/admin/contact"); await expect(page.getByRole("heading", { name: payload.subject, exact: true })).toBeVisible(); await expect(page.getByText(payload.message, { exact: true })).toBeVisible(); expect(await page.evaluate(() => (window as Window & { __storedInjection?: boolean }).__storedInjection)).toBeUndefined(); expect(await page.locator('article img[src="x"]').count()).toBe(0);
    const cookies = await page.context().cookies(); for (const name of ["urbankare_session", "urbankare_refresh"]) { const session = cookies.find(cookie => cookie.name === name); expect(session?.httpOnly, name).toBe(true); expect(session?.sameSite, name).toBe("Lax"); } expect(cookies.some(cookie => /^_ga/.test(cookie.name))).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await db.collection("contact_requests").deleteMany({ email: `privacy-${stamp}@example.test` });
    if (adminId) { await db.collection("sessions").deleteMany({ user_id: adminId }); await db.collection("users").updateOne({ id: adminId }, { $set: { role: "CUSTOMER" } }); await db.collection("platform_account_status").updateOne({ user_id: adminId }, { $set: { active: 0 } }); }
    await closeRedis(); await closeMongo();
  }
});
