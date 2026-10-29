import { randomUUID } from "node:crypto";
import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

test.use({ reducedMotion: "reduce" });

test("authentication forms cannot submit secrets in a URL before JavaScript is ready", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    for (const [path, label] of [["/login", "Sign in"], ["/register", "Create account"], [`/login/reset?token=${"0".repeat(64)}`, "Update password"]]) {
      await page.goto(path);
      // React streams an async page inside a hidden segment until its reveal
      // script runs. Inspect that delivered form even with scripts disabled.
      const submit = page.getByRole("button", { name: label, exact: true, includeHidden: true });
      await expect(submit).toBeDisabled();
      await expect(page.locator("form").filter({ has: submit })).toHaveAttribute("method", "post");
    }
  } finally { await context.close(); }
});

test("shared mobile sign-in routes database roles, accepts a private login ID and preserves verification", async ({ page, baseURL }, info) => {
  test.skip(!process.env.MONGODB_DB?.startsWith("urbankare_test_e2e_"), "Requires an explicitly isolated acceptance database.");
  expect(["localhost", "127.0.0.1"].includes(new URL(baseURL!).hostname)).toBe(true);
  const { registerUser } = await import("../../lib/auth");
  const { bootstrapAdministrator } = await import("../../lib/admin-bootstrap");
  const { getMongoDb, closeMongo } = await import("../../lib/mongo");
  const { closeRedis } = await import("../../lib/redis");
  const stamp = randomUUID(), password = `QA-${randomUUID()}!`;
  const email = `login-${stamp}@example.test`, alias = `qa-${stamp}#example.test`;
  const customer = await registerUser("QA Login Customer", email, password, undefined, { requireVerification: true });
  const provider = await registerUser("QA Login Provider", `provider-${stamp}@example.test`, password);
  await bootstrapAdministrator(alias, password);
  const db = await getMongoDb();
  await db.collection("users").updateOne({ id: provider.id }, { $set: { role: "PROVIDER" } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 320, height: 740 });
  try {
    await page.goto("/login");
    await expect(page.getByText(/accounts are not open yet/i)).toHaveCount(0);
    const codeToggle = page.getByRole("button", { name: "Sign in with an email code instead", exact: true });
    if (process.env.E2E_EMAIL_CHANNEL === "1") {
      await expect(codeToggle).toBeVisible();
      await codeToggle.click();
      await expect(page.getByRole("button", { name: "Email me a code", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Use my password instead", exact: true }).click();
      await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    }
    for (const actor of [
      { identifier: email, role: "CUSTOMER", path: /\/dashboard$/ },
      { identifier: alias.toUpperCase(), role: "SUPER_ADMIN", path: /\/admin\/dashboard$/ },
      { identifier: provider.email, role: "PROVIDER", path: /\/provider\/dashboard$/ },
    ]) {
      await page.context().clearCookies();
      await page.goto("/login");
      await page.getByLabel("Email or login ID", { exact: true }).fill(actor.identifier);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Show password", exact: true }).click();
      await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
      await page.getByRole("button", { name: "Hide password", exact: true }).click();
      const signedIn = page.waitForResponse(response => response.url().endsWith("/api/auth/login") && response.request().method() === "POST");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      expect((await signedIn).status()).toBe(200);
      await expect(page).toHaveURL(actor.path);
      const session = await (await page.request.get("/api/auth/me")).json();
      expect(session.user.role).toBe(actor.role);
      expect((await page.context().cookies()).filter(cookie => cookie.name.startsWith("urbankare_")).every(cookie => cookie.httpOnly)).toBe(true);
      if (actor.role === "CUSTOMER") {
        expect(session.user.email_verified).toBe(0);
        expect((await page.request.get("/api/admin/users")).status()).toBe(404);
        const booking = await page.request.post("/api/bookings", { headers: { Origin: baseURL! }, data: {} });
        expect(booking.status()).toBe(403);
        expect((await booking.json()).error).toMatch(/verify your email/i);
        await page.goto("/dashboard/verify");
        await expect(page.getByRole("heading", { name: "Verify your email", exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Switch to dark mode", exact: true }).click();
        await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
        await page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => undefined))); });
        const verificationAxe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(verificationAxe.violations.map(violation => ({ id: violation.id, targets: violation.nodes.map(node => node.target) }))).toEqual([]);
        await page.getByRole("button", { name: "Switch to light mode", exact: true }).click();
        await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
        if (process.env.E2E_EMAIL_CHANNEL === "1") {
          const { issueEmailOtp } = await import("../../lib/auth-otp");
          const code = await issueEmailOtp(customer.id, email, "verify");
          await page.getByLabel("Six-digit code", { exact: true }).fill(code);
          await page.getByRole("button", { name: "Verify email", exact: true }).click();
          await expect(page).toHaveURL(/\/dashboard$/);
          expect((await (await page.request.get("/api/auth/me")).json()).user.email_verified).toBe(1);
        } else await expect(page.getByText(/Email verification is temporarily unavailable/)).toBeVisible();
        if (process.env.E2E_EMAIL_CHANNEL !== "1") await page.goto("/dashboard");
        await page.getByRole("button", { name: "Sign out", exact: true }).click();
        await expect(page).toHaveURL(/\/login$/);
        expect((await (await page.request.get("/api/auth/me")).json()).user).toBeNull();
      }
      if (actor.role === "SUPER_ADMIN") {
        await page.screenshot({ path: `artifacts/login-admin-${info.project.name || process.env.E2E_BROWSER || "chromium"}-320.png` });
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
    }
    expect(errors).toEqual([]);
  } finally {
    await closeRedis(); await closeMongo();
  }
});

test("HTML sign-out revokes cookies and redirects to shared sign-in", async ({ browser, baseURL }) => {
  test.skip(!process.env.MONGODB_DB?.startsWith("urbankare_test_e2e_"), "Requires an explicitly isolated acceptance database.");
  const { registerUser } = await import("../../lib/auth");
  const { closeMongo } = await import("../../lib/mongo");
  const { closeRedis } = await import("../../lib/redis");
  const password = `QA-${randomUUID()}!`, email = `native-${randomUUID()}@example.test`;
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  try {
    await registerUser("QA Native Logout", email, password);
    const response = await context.request.post("/api/auth/login", { headers: { Origin: baseURL! }, data: { email, password } });
    expect(response.status()).toBe(200);
    const signedOut = await context.request.post("/api/auth/logout", { headers: { Origin: baseURL!, Accept: "text/html" }, maxRedirects: 0 });
    expect(signedOut.status()).toBe(303);
    expect(new URL(signedOut.headers().location).pathname).toBe("/login");
    expect((await (await context.request.get("/api/auth/me")).json()).user).toBeNull();
    expect((await context.cookies()).some(cookie => cookie.name === "urbankare_refresh" || cookie.name === "urbankare_session")).toBe(false);
  } finally { await context.close(); await closeRedis(); await closeMongo(); }
});
