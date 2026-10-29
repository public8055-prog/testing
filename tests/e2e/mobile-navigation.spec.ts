import { test, expect } from "./fixtures";

test("mobile shell has reachable navigation, compact service search and session-aware account links", async ({ page, baseURL }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const navigation = page.getByRole("navigation", { name: "Primary mobile navigation" });
  await expect(navigation).toBeVisible();
  const destinations = { Home: "/", Services: "/services", Activity: "/dashboard/tracking", Updates: "/dashboard/updates", Account: "/dashboard" };
  for (const [name, href] of Object.entries(destinations)) {
    const link = navigation.getByRole("link", { name, exact: true });
    await expect(link).toHaveAttribute("href", href);
    const bounds = await link.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(321);
  }
  await expect(navigation.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".header-book")).toBeHidden();
  await expect(page.getByRole("link", { name: "Admin dashboard", exact: true })).toHaveCount(0);
  const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, bottomPadding: parseFloat(getComputedStyle(document.body).paddingBottom), navigationHeight: document.querySelector(".mobile-bottom-nav")!.getBoundingClientRect().height, searchTop: document.querySelector(".hero-search")!.getBoundingClientRect().top, imageTop: document.querySelector(".hero-visual")!.getBoundingClientRect().top }));
  expect(layout.width).toBeLessThanOrEqual(layout.viewport + 1);
  expect(layout.bottomPadding).toBeGreaterThanOrEqual(layout.navigationHeight - 1);
  expect(layout.searchTop).toBeLessThan(600);
  expect(layout.searchTop).toBeLessThan(layout.imageTop);
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  const more = page.getByRole("navigation", { name: "More navigation", exact: true });
  await expect(more).toBeVisible();
  await expect(more.getByRole("link", { name: "Log in", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(more).toBeHidden();
  await expect(page.getByRole("button", { name: "Open navigation", exact: true })).toBeFocused();
  await page.screenshot({ path: info.outputPath("mobile-home-320.png"), fullPage: true });

  await navigation.getByRole("link", { name: "Services", exact: true }).click();
  await expect(page).toHaveURL(/\/services$/);
  await expect(navigation.getByRole("link", { name: "Services", exact: true })).toHaveAttribute("aria-current", "page");
  await navigation.getByRole("link", { name: "Activity", exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === "/login" && url.searchParams.get("next") === "/dashboard/tracking");
  await navigation.getByRole("link", { name: "Updates", exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === "/login" && url.searchParams.get("next") === "/dashboard/updates");

  const registration = await page.request.post("/api/auth/register", { headers: { Origin: baseURL! }, data: { name: "Mobile Navigation User", email: `mobile-${Date.now()}@example.test`, password: "Mobile-navigation-passphrase-2026!",termsAccepted:true,privacyConsent:true,adultConfirmed:true } });
  expect(registration.status(), await registration.text()).toBe(201);
  await navigation.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === "/" && !url.search);
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await expect(more).toBeVisible();
  await expect(more.getByRole("link", { name: "Mobile's account", exact: true })).toHaveAttribute("href", "/dashboard");
  await expect(more.getByRole("link", { name: "Log in", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(navigation).toBeHidden();
  await expect(page.locator(".header-login")).toContainText("Mobile");
  await expect(page.locator(".header-login")).toHaveAttribute("href", "/dashboard");
  expect(errors).toEqual([]);
});
