import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "./fixtures";

// Automated findings complement keyboard checks; they do not establish full WCAG conformance.
test.use({ reducedMotion: "reduce" });

async function openAccessiblePage(page: Page, route: string) {
  const response = await page.goto(route, { waitUntil: "domcontentloaded" });
  expect(response?.status(), route).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator(".account-session-loading")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

async function auditPage(page: Page, info: TestInfo, name: string) {
  // No exclusions or disabled rules: shared header, footer, overlays and contrast stay in scope.
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  await info.attach(`axe-${name}.json`, {
    contentType: "application/json",
    body: JSON.stringify({
      url: page.url(), viewport: page.viewportSize(), timestamp: results.timestamp,
      testEngine: results.testEngine, violations: results.violations,
      incomplete: results.incomplete, passedRuleIds: results.passes.map(rule => rule.id),
    }, null, 2),
  });
  const findings = results.violations.map(violation => ({
    id: violation.id, impact: violation.impact, help: violation.help, helpUrl: violation.helpUrl,
    nodes: violation.nodes.map(node => ({ target: node.target, failureSummary: node.failureSummary })),
  }));
  expect.soft(findings, `WCAG A/AA findings on ${page.url()}`).toEqual([]);
}

const publicRoutes = [
  ["home", "/"],
  ["providers", "/services"],
  ["catalogue", "/search"],
  ["service", "/services/bathroom-deep-cleaning"],
  ["login", "/login"],
  ["register", "/register"],
  ["contact", "/contact"],
  ["privacy", "/privacy"],
  ["terms", "/terms"],
  ["cookies", "/cookies"],
  ["refund", "/refund-policy"],
] as const;

for (const layout of [
  { name: "desktop", viewport: { width: 1280, height: 900 } },
  { name: "mobile", viewport: { width: 320, height: 740 } },
]) {
  test.describe(`${layout.name} WCAG A/AA`, () => {
    test.use({ viewport: layout.viewport });
    for (const [name, route] of publicRoutes) {
      test(`${name} has no automated accessibility violations`, async ({ page }, info) => {
        await openAccessiblePage(page, route);
        if (layout.name === "mobile") {
          expect(await page.evaluate(() => document.documentElement.scrollWidth), route).toBeLessThanOrEqual(321);
          await expect(page.getByRole("navigation", { name: "Primary mobile navigation", exact: true })).toBeVisible();
        }
        await auditPage(page, info, `${layout.name}-${name}`);
      });
    }
  });
}

test("keyboard skip link bypasses repeated header links", async ({ page }) => {
  await openAccessiblePage(page, "/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content", exact: true });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content$/);
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest("main")))).toBe(true);
});

test("mobile menu and cart support keyboard entry, dismissal and focus return", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await openAccessiblePage(page, "/");
  const toggle = page.locator(".mobile-toggle");
  await toggle.focus();
  await page.keyboard.press("Enter");
  const more = page.getByRole("navigation", { name: "More navigation", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(more).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(more.getByRole("link").first()).toBeFocused();
  await auditPage(page, info, "mobile-menu-open");
  await page.keyboard.press("Escape");
  await expect(more).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();

  const cart = page.getByRole("button", { name: "Open cart", exact: true });
  await cart.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close cart", exact: true })).toBeFocused();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press(i === 0 ? "Shift+Tab" : "Tab");
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await auditPage(page, info, "mobile-cart-open");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(cart).toBeFocused();
});

test("login and contact fields expose labels and follow a usable keyboard order", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await openAccessiblePage(page, "/login");
  const email = page.getByRole("textbox", { name: "Email or login ID", exact: true });
  const password = page.getByLabel("Password", { exact: true });
  await email.focus();
  await page.keyboard.press("Tab");
  await expect(password).toBeFocused();
  await password.fill("Keyboard-only-example-password");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Show password", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(password).toHaveAttribute("type", "text");
  const hide = page.getByRole("button", { name: "Hide password", exact: true });
  await expect(hide).toHaveAttribute("aria-pressed", "true");
  await expect(hide).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(password).toHaveAttribute("type", "password");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeFocused();

  await openAccessiblePage(page, "/contact");
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  await page.getByRole("button", { name: "Send support request", exact: true }).click();
  await expect(name).toBeFocused(); // Native required-field validation, without sending a request.
  const fields = [name, page.getByRole("textbox", { name: "Reply email", exact: true }), page.getByRole("textbox", { name: "Subject", exact: true }), page.getByRole("textbox", { name: "How can we help?", exact: true })];
  for (const field of fields) {
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute("required", "");
    await page.keyboard.press("Tab");
  }
  const consent = page.getByRole("checkbox", { name: /I consent to using these details to handle my request/ });
  await expect(consent).toBeFocused();
  await expect(consent).not.toBeChecked();
  await page.keyboard.press("Space");
  await expect(consent).toBeChecked();
  await page.keyboard.press("Space");
  await expect(consent).not.toBeChecked();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Privacy notice", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Send support request", exact: true })).toBeFocused();
});
