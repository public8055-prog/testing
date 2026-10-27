import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

test.use({ viewport: { width: 320, height: 740 }, colorScheme: "dark", reducedMotion: "reduce" });

// Playwright's page fixture creates an independent browser context for each route.
for (const [name, route] of [
  ["home", "/"],
  ["search", "/search"],
  ["service", "/services/bathroom-deep-cleaning"],
  ["contact", "/contact"],
] as const) {
  test(`dark ${name} has no automated accessibility violations at 320px`, async ({ page }, info) => {
    await page.addInitScript(() => localStorage.setItem("urbankare-theme", "dark"));
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status(), route).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    if (name === "search") await expect(page.getByRole("heading", { level: 1, name: "Home services, sorted.", exact: true })).toBeVisible();
    if (name === "service") await expect(page.getByRole("heading", { level: 1, name: /bathroom deep cleaning/i })).toBeVisible();
    if (name === "contact") await expect(page.getByRole("textbox", { name: "Your name", exact: true })).toBeVisible();
    await expect(page.locator(".account-session-loading")).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    // All default rules and the complete page remain in scope, including contrast.
    const results = await new AxeBuilder({ page }).analyze();
    await info.attach(`axe-dark-${name}.json`, {
      contentType: "application/json",
      body: JSON.stringify({
        url: page.url(), viewport: page.viewportSize(), theme: "dark",
        timestamp: results.timestamp, testEngine: results.testEngine,
        violations: results.violations, incomplete: results.incomplete,
        passedRuleIds: results.passes.map(rule => rule.id),
      }, null, 2),
    });
    expect.soft(results.violations, `Dark-mode accessibility findings on ${route}`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), route).toBeLessThanOrEqual(321);
  });
}
