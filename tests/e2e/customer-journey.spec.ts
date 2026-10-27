import { test, expect, type Page, type TestInfo } from "./fixtures";

test.afterEach(async ({ page, baseURL }, info) => {
  const bookingId = info.annotations.find((annotation) => annotation.type === "created-e2e-booking")?.description;
  if (!bookingId) return;
  const response = await page.request.get(`/api/bookings/${bookingId}`).catch(() => null);
  if (!response?.ok()) return;
  const { booking } = await response.json();
  if (["pending", "confirmed"].includes(booking.status)) {
    // Release only an appointment created by this test if a later assertion failed.
    const result = await page.request.patch(`/api/bookings/${bookingId}`, { headers: { Origin: baseURL! }, data: { action: "cancel" } });
    await info.attach("test-booking-cleanup", { body: `Booking ${bookingId}: cancellation HTTP ${result.status()}`, contentType: "text/plain" });
  }
});

async function capturePage(page: Page, info: TestInfo, filename: string) {
  // Scroll normally so lazy service photos are requested before a full-page capture.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const step = Math.max(400, (page.viewportSize()?.height || 800) - 100);
  for (let y = 0; y < height; y += step) {
    await page.evaluate((scrollY) => window.scrollTo(0, scrollY), y);
    await page.waitForTimeout(50);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => Array.from(document.querySelectorAll("main img")).every((image) => (image as HTMLImageElement).complete), undefined, { timeout: 12_000 }).catch(() => undefined);
  const images = await page.locator("main img").evaluateAll((elements) => elements.map((element) => {
    const image = element as HTMLImageElement;
    return { alt: image.alt, loaded: image.complete && image.naturalWidth > 0, src: image.currentSrc || image.src };
  }));
  await info.attach(`image-check-${filename}.json`, { body: JSON.stringify(images, null, 2), contentType: "application/json" });
  await page.screenshot({ path: info.outputPath(filename), fullPage: true, animations: "disabled" });
}

async function assertNoHorizontalOverflow(page: Page) {
  const layout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    offenders: Array.from(document.querySelectorAll("main *")).filter((el) => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.right > window.innerWidth + 2 && getComputedStyle(el).position !== "fixed";
    }).slice(0, 5).map((el) => ({ tag: el.tagName, text: el.textContent?.slice(0, 80), right: Math.round(el.getBoundingClientRect().right) })),
  }));
  expect(layout.document, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport + 1);
}

test("desktop discovery searches the catalog and opens category and service details", async ({ page }, testInfo) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await test.step("Browse the storefront, search and category", async () => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: "UrbanKare home" })).toBeVisible();
    await expect(page.locator("main h1")).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await capturePage(page, testInfo, "01-desktop-storefront.png");
    await page.getByRole("combobox", { name: "SERVICE", exact: true }).selectOption("home-cleaning");
    await page.getByRole("button", { name: "Find services", exact: true }).click();
    await expect(page).toHaveURL(/\/services\?category=home-cleaning/);
    // The URL commits before the streamed result replaces its loading skeleton.
    // Verify the requested result before navigating to the catalogue.
    await expect(page.getByRole("heading", { name: "The right help. Right here.", exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Category", exact: true })).toHaveValue("Home Cleaning");
    await page.getByRole("link", { name: "Service catalogue", exact: true }).click();
    await expect(page.locator("main article").first()).toBeVisible();
    await page.getByRole("textbox", { name: "Search the service catalog" }).fill("thisservicedoesnotexist9837");
    await expect(page.getByRole("button", { name: "Clear filters" })).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.locator("main article").first()).toBeVisible();
    await page.getByRole("combobox", { name: "Sort services" }).selectOption("price-low");
    const prices = await page.locator("main article").allTextContents().then((cards) => cards.map((card) => Number(card.match(/₹\s*([\d,]+)/)?.[1].replace(/,/g, ""))));
    expect(prices.length).toBeGreaterThan(0);
    expect(prices.every(Number.isFinite)).toBe(true);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    await page.getByRole("combobox", { name: "Filter by maximum price" }).selectOption("500");
    const budgetPrices = await page.locator("main article").allTextContents().then((cards) => cards.map((card) => Number(card.match(/₹\s*([\d,]+)/)?.[1].replace(/,/g, ""))));
    expect(budgetPrices.length).toBeGreaterThan(0);
    expect(budgetPrices.every((price) => price <= 500)).toBe(true);
    await page.goto("/categories/home-cleaning");
    await expect(page).toHaveURL(/\/categories\/home-cleaning/);
    await expect(page.locator("main h1")).toBeVisible();
    await page.locator('a[href="/services/bathroom-deep-cleaning"]').first().click();
    await expect(page).toHaveURL(/\/services\/bathroom-deep-cleaning/);
    await page.getByRole("navigation", { name: "Service details", exact: true }).locator('a[href="#included"]').click();
    await expect(page.locator("#included h2")).toBeVisible();
    await expect(page.locator("#included").getByRole("listitem").first()).toBeVisible();
    await page.locator("#faqs summary").first().click();
    await expect(page.locator("#faqs details[open]").first()).toBeVisible();
    await capturePage(page, testInfo, "02-service-details.png");
  });
  expect(runtimeErrors, "Browser runtime errors").toEqual([]);
});

test("desktop customer completes cart, account, cash booking, isolation, reschedule, cancellation and login", async ({ page, browser, baseURL }, testInfo) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  const stamp = `${Date.now()}-${testInfo.workerIndex}`;
  const email = `e2e-customer-${stamp}@example.test`;
  const password = "E2e-local-only-passphrase!";
  const address = `E2E Test Apartment ${stamp}, Bengaluru, Karnataka 560001`;
  let bookingId = "";
  await page.goto("/services/bathroom-deep-cleaning");

  await test.step("Add service and verify the cart survives refresh", async () => {
    await page.getByRole("button", { name: "Add to cart", exact: true }).click();
    await expect(page.getByText("1 in your cart", { exact: false })).toBeVisible();
    await page.goto("/cart");
    await expect(page.getByRole("heading", { name: "Your cart", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Add one.*bathroom/i })).toBeVisible();
    await page.getByRole("button", { name: /Add one.*bathroom/i }).click();
    await page.reload();
    await expect(page.getByRole("button", { name: "Open cart, 2 items" })).toBeVisible();
    await page.getByRole("button", { name: /Remove one.*bathroom/i }).click();
    await expect(page.getByRole("button", { name: "Open cart, 1 items" })).toBeVisible();
    await page.getByRole("link", { name: /Proceed to checkout/ }).click();
    await expect(page.getByRole("button", { name: "Sign in to book" })).toBeVisible();
    await page.getByRole("button", { name: "Sign in to book" }).click();
    await expect(page).toHaveURL(/\/login\?next=(?:%2F|\/)checkout$/);
  });

  await test.step("Create a customer account through the browser", async () => {
    await page.getByRole("link", { name: "Create an account", exact: true }).click();
    await expect(page).toHaveURL(/\/register\?next=(?:%2F|\/)checkout$/);
    await page.getByRole("textbox", { name: "Full name", exact: true }).fill("E2E Customer");
    await page.getByRole("textbox", { name: "Email address", exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("checkbox",{name:/I accept the Terms of Service/}).check();
    await page.getByRole("checkbox",{name:"I confirm that I am 18 years or older.",exact:true}).check();
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page).toHaveURL(/\/checkout$/, { timeout: 45_000 });
  });

  await test.step("Complete a cash booking using actual checkout", async () => {
    await page.getByLabel("Full name", { exact: true }).fill("E2E Customer");
    await page.getByLabel("Phone number", { exact: true }).fill("9876543210");
    await page.getByLabel("Full address", { exact: true }).fill(address);
    await expect(page.getByRole("button", { name: "11:00 AM", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "11:00 AM", exact: true }).click();
    await page.getByRole("button", { name: /Cash.*After service/i }).click();
    await capturePage(page, testInfo, "03-checkout.png");
    const bookingResponse = page.waitForResponse((response) => response.url().endsWith("/api/bookings") && response.request().method() === "POST");
    await page.getByRole("button", { name: /^Confirm ·/ }).click();
    const result = await bookingResponse;
    const body = await result.json();
    expect(result.status(), JSON.stringify(body)).toBe(201);
    bookingId = body.booking.id;
    testInfo.annotations.push({ type: "created-e2e-booking", description: bookingId });
    expect(body.booking.status).toBe("confirmed");
    expect(body.booking.paymentStatus).toBe("unpaid");
    await expect(page).toHaveURL(new RegExp(`/bookings/${bookingId}\\?success=1`));
    await expect(page.getByRole("heading", { name: "Booking confirmed!" })).toBeVisible();
    await expect(page.getByText(address, { exact: true })).toBeVisible();
    await capturePage(page, testInfo, "04-booking-confirmed.png");
    expect((await page.request.get("/api/admin/bookings")).status()).toBe(404);
  });

  await test.step("A separate customer cannot read or cancel this booking", async () => {
    const outsider = await browser.newContext({ baseURL });
    try {
      const registered = await outsider.request.post("/api/auth/register", {
        headers: { Origin: baseURL! },
        data: { name: "E2E Other Customer", email: `e2e-other-${stamp}@example.test`, password,termsAccepted:true,privacyConsent:true,adultConfirmed:true },
      });
      expect(registered.status(), await registered.text()).toBe(201);
      expect((await outsider.request.get(`/api/bookings/${bookingId}`)).status()).toBe(404);
      expect((await outsider.request.patch(`/api/bookings/${bookingId}`, { headers: { Origin: baseURL! }, data: { action: "cancel" } })).status()).toBe(404);
      const privatePage = await outsider.newPage();
      await privatePage.goto(`/bookings/${bookingId}`);
      await expect(privatePage.getByText(address, { exact: true })).toHaveCount(0);
      await expect(privatePage.getByRole("heading", { name: "This page has moved out.", exact: true })).toBeVisible();
    } finally { await outsider.close(); }
  });

  await test.step("Cancel the owned booking and sign back in", async () => {
    await page.getByRole("button", { name: "Reschedule visit", exact: true }).click();
    const newDate = new Date(Date.now() + 19800000 + 2 * 86400000).toISOString().slice(0, 10);
    await page.getByLabel("New date", { exact: true }).fill(newDate);
    await expect(page.getByRole("button", { name: "01:00 PM", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "01:00 PM", exact: true }).click();
    await page.getByRole("button", { name: "Save new time", exact: true }).click();
    await expect(page.getByText(`${newDate} · 01:00 PM`, { exact: true })).toBeVisible();
    await capturePage(page, testInfo, "05-booking-rescheduled.png");
    await page.getByRole("button", { name: "Cancel booking", exact: true }).click();
    await page.getByRole("button", { name: "Confirm cancellation", exact: true }).click();
    await expect(page.getByText("CANCELLED", { exact: true })).toBeVisible();
    const saved = await page.request.get(`/api/bookings/${bookingId}`);
    expect((await saved.json()).booking.status).toBe("cancelled");
    await page.goto("/account");
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Email or login ID", exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    await page.goto("/bookings");
    await expect(page.locator(`a[href="/bookings/${bookingId}"]`)).toBeVisible();
  });
  expect(runtimeErrors, "Browser runtime errors").toEqual([]);
});

test("mobile storefront, search, service and filled cart stay within the viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const routes = ["/", "/search", "/categories/home-cleaning", "/services/bathroom-deep-cleaning", "/account"];
  for (const route of routes) {
    await test.step(`Mobile layout ${route}`, async () => {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.locator("main h1")).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await capturePage(page, testInfo, `mobile-${route.replace(/\W+/g, "-") || "home"}.png`);
    });
  }
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "More navigation", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "More navigation", exact: true }).getByRole("link", { name: "Services", exact: true }).click();
  await expect(page).toHaveURL(/\/services$/);
  await page.goto("/services/bathroom-deep-cleaning");
  await page.getByRole("button", { name: "Add to cart", exact: true }).click();
  await page.goto("/cart");
  await expect(page.getByRole("link", { name: /Proceed to checkout/ })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await capturePage(page, testInfo, "mobile-filled-cart.png");
  await page.goto("/checkout");
  await expect(page.getByRole("heading", { name: "Checkout", exact: true })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await capturePage(page, testInfo, "mobile-checkout.png");
});
