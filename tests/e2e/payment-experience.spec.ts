import { test, expect, type Page } from "./fixtures";

// All gateway responses in this file are simulated. No payment-provider request or charge is made.
const serviceSlug = "bathroom-deep-cleaning";
const simulatedBookingId = "simulated-stripe-booking";

async function prepareCheckout(page: Page, methods: { upi: boolean; card: boolean }) {
  await page.addInitScript((slug) => {
    localStorage.setItem("urbanhome-cart", JSON.stringify({ state: { lines: [{ slug, qty: 1 }] }, version: 0 }));
  }, serviceSlug);
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: { id: "simulated-user", name: "Simulated Customer", email: "simulated@example.test" } } }));
  await page.route("**/api/payments/config", route => route.fulfill({ json: {
    enabled: methods.upi || methods.card,
    methods,
    preferredGateway: methods.upi ? "razorpay" : "stripe",
    gateways: { razorpay: { enabled: methods.upi, testMode: true }, stripe: { enabled: methods.card && !methods.upi, testMode: true } },
  } }));
  await page.route("**/api/quote", async route => {
    const input = route.request().postDataJSON();
    await route.fulfill({ json: {
      items: [{ slug: serviceSlug, qty: 1, s: { slug: serviceSlug, title: "Bathroom Deep Cleaning", price: 549, durationMin: 60, image: "/favicon.ico" } }],
      subtotal: 549, discount: 55, visitFee: 49, total: 543, durationMin: 60, date: input.date,
      slots: [{ slot: "11:00 AM", available: true, remaining: 5, reason: null }],
    } });
  });
  await page.goto("/checkout", { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue("Simulated Customer");
  await expect(page.getByRole("button", { name: /^Confirm/ })).toBeEnabled();
}

for (const scenario of [
  { name: "Stripe-only enables cards and disables UPI", upi: false, card: true },
  { name: "Razorpay availability enables cards and UPI", upi: true, card: true },
  { name: "unavailable online gateways leave cash available", upi: false, card: false },
]) {
  test(`simulated payment configuration: ${scenario.name}`, async ({ page }) => {
    await prepareCheckout(page, scenario);
    const upi = page.getByRole("button", { name: /^UPI/ });
    const card = page.getByRole("button", { name: /^Card/ });
    if (scenario.upi) await expect(upi).toBeEnabled(); else await expect(upi).toBeDisabled();
    if (scenario.card) await expect(card).toBeEnabled(); else await expect(card).toBeDisabled();
    await expect(page.getByRole("button", { name: /^Cash/ })).toBeEnabled();
  });
}

test("simulated Stripe checkout redirects once without creating a Razorpay order", async ({ page }, info) => {
  let checkoutRequests = 0;
  let legacyOrderRequests = 0;
  let bookingRequests = 0;
  await page.route("**/api/bookings", async route => {
    if (route.request().method() !== "POST") return route.continue();
    const input = route.request().postDataJSON();
    expect(input.payment).toBe("card");
    expect(input.items).toEqual([{ slug: serviceSlug, qty: 1 }]);
    bookingRequests += 1;
    await route.fulfill({ status: 201, json: { booking: { id: simulatedBookingId, name: input.name, phone: input.phone } } });
  });
  await page.route("**/api/payments/checkout", async route => {
    expect(route.request().postDataJSON()).toEqual({ bookingId: simulatedBookingId });
    checkoutRequests += 1;
    await route.fulfill({ json: { gateway: "stripe", checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_simulated", sessionId: "cs_test_simulated", bookingId: simulatedBookingId } });
  });
  await page.route("**/api/payments/orders", async route => {
    legacyOrderRequests += 1;
    await route.fulfill({ status: 500, json: { error: "Unexpected legacy order request" } });
  });
  await page.route("https://checkout.stripe.com/**", route => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><html><head><title>Simulated Stripe checkout</title></head><body><h1>Simulated Stripe checkout</h1><p>No payment provider was contacted and no charge was made.</p></body></html>",
  }));
  await prepareCheckout(page, { upi: false, card: true });
  await page.getByRole("button", { name: /^Card/ }).click();
  await page.getByLabel("Phone number", { exact: true }).fill("9876543210");
  await page.getByLabel("Full address", { exact: true }).fill("Simulated Test Apartment, Bengaluru, Karnataka 560001");
  await page.getByRole("button", { name: /^Confirm/ }).click();
  await expect(page).toHaveURL("https://checkout.stripe.com/c/pay/cs_test_simulated");
  await expect(page.getByRole("heading", { name: "Simulated Stripe checkout" })).toBeVisible();
  expect(bookingRequests).toBe(1);
  expect(checkoutRequests).toBe(1);
  expect(legacyOrderRequests).toBe(0);
  await page.screenshot({ path: info.outputPath("simulated-stripe-redirect.png"), fullPage: true });
});
