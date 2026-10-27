import { test, expect, type Page, type TestInfo } from "./fixtures";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { Document } from "mongodb";

async function assertMobileLayout(page: Page, info: TestInfo, stage: string) {
  const layout = await page.evaluate(() => {
    const describe = (element: Element) => {
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      return { tag: element.tagName, className: typeof element.className === "string" ? element.className : "", left: box.left, right: box.right, width: box.width, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, display: style.display, minWidth: style.minWidth, gridTemplateColumns: style.gridTemplateColumns, overflowX: style.overflowX };
    };
    return {
      viewport: innerWidth, document: document.documentElement.scrollWidth,
      containers: Array.from(document.querySelectorAll("main, main > div, main aside, main nav, dialog[open]")).map(describe),
      overflowing: Array.from(document.querySelectorAll("body *")).filter(element => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && (box.right > innerWidth + 1 || box.left < -1) && getComputedStyle(element).visibility !== "hidden";
      }).slice(0, 30).map(describe),
    };
  });
  await info.attach(`mobile-layout-${stage}.json`, { body: JSON.stringify(layout, null, 2), contentType: "application/json" });
  expect(layout.document, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport + 1);
}

test("a private administrator follow-up reaches only its customer through the live Redis update stream", async ({ page, browser, baseURL }, info) => {
  test.setTimeout(180_000);
  test.skip(!baseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname), "Private test bootstrap is restricted to a local preview.");
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  test.skip(!/^mongodb:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(process.env.MONGODB_URI || ""), "This fixture requires local MongoDB.");
  const { bootstrapAdministrator } = await import("../../lib/admin-bootstrap");
  const { getMongoDb, closeMongo } = await import("../../lib/mongo");
  const { closeRedis } = await import("../../lib/redis");
  const db = await getMongoDb(), collection = (name: string) => db.collection<Document & { _id: string }>(name);
  const stamp = randomUUID(), alias = `qa-operations-${stamp}#example.test`, password = `QA-operations-${randomUUID()}!`;
  const customerContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const outsiderContext = await browser.newContext({ baseURL });
  const customerPage = await customerContext.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  customerPage.on("pageerror", error => errors.push(error.message));
  const origin = { Origin: baseURL! };
  let administratorId = "", bookingId = "";
  const userIds: string[] = [];
  const streamEvents: { name: string; data: string; transport: "websocket" | "sse" }[] = [];
  const liveSockets = new Set<string>();
  const protocol = await customerContext.newCDPSession(customerPage);
  await protocol.send("Network.enable");
  protocol.on("Network.eventSourceMessageReceived", event => streamEvents.push({ name: event.eventName, data: event.data, transport: "sse" }));
  protocol.on("Network.webSocketCreated", event => { if (new URL(event.url).pathname === "/api/live") liveSockets.add(event.requestId); });
  protocol.on("Network.webSocketFrameReceived", event => { if (!liveSockets.has(event.requestId)) return; try { const message = JSON.parse(event.response.payloadData); streamEvents.push({ name: message.type, data: JSON.stringify(message.data ?? null), transport: "websocket" }); } catch { /* A non-JSON frame cannot satisfy the live transport assertions. */ } });
  try {
    administratorId = (await bootstrapAdministrator(alias, password, "QA Service Operations Administrator")).id;
    await page.goto("/login?next=%2Fadmin%2Fdashboard");
    await page.getByLabel("Email or login ID", { exact: true }).fill(alias);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard$/);

    for (const [context, suffix] of [[customerContext, "owner"], [outsiderContext, "other"]] as const) {
      const response = await context.request.post("/api/auth/register", { headers: origin, data: { name: `QA Operations ${suffix}`, email: `operations-${suffix}-${stamp}@example.test`, password,termsAccepted:true,privacyConsent:true,adultConfirmed:true } });
      expect(response.status(), await response.text()).toBe(201);
      userIds.push((await response.json()).user.id);
    }
    const date = new Date(Date.now() + 19_800_000 + 3 * 86_400_000).toISOString().slice(0, 10);
    const items = [{ slug: "bathroom-deep-cleaning", qty: 1 }];
    const quoteResponse = await customerContext.request.post("/api/quote", { headers: origin, data: { items, date } });
    expect(quoteResponse.ok(), await quoteResponse.text()).toBe(true);
    const quote = await quoteResponse.json(), slot = quote.slots.find((value: { slot: string; available: boolean }) => value.available)?.slot;
    expect(slot).toBeTruthy();
    const bookingResponse = await customerContext.request.post("/api/bookings", { headers: { ...origin, "idempotency-key": randomUUID() }, data: { items, name: "QA Operations Customer", phone: "9876543210", address: "QA Operations Apartment, Bengaluru, Karnataka 560001", date, slot, payment: "cash", expectedTotal: quote.total } });
    expect(bookingResponse.status(), await bookingResponse.text()).toBe(201);
    bookingId = (await bookingResponse.json()).booking.id;
    const tracked = await (await customerContext.request.get("/api/service-tracking")).json();
    const service = tracked.services.find((value: { bookingId: string }) => value.bookingId === bookingId);
    expect(service?.token).toMatch(/^TKN-\d{8}-\d{4,}$/);
    const token: string = service.token, tokenId: string = service.tokenId;
    expect(tokenId).toBe(`catalog:${bookingId}`);

    const intruderTracking = await outsiderContext.request.get(`/api/service-tracking?tokenId=${encodeURIComponent(tokenId)}`);
    expect(intruderTracking.ok()).toBe(true);
    expect((await intruderTracking.json()).services).toEqual([]);
    expect((await outsiderContext.request.get(`/api/bookings/${bookingId}`)).status()).toBe(404);
    expect((await customerContext.request.get("/api/admin/operations")).status()).toBe(404);
    expect((await customerContext.request.patch("/api/admin/operations", { headers: origin, data: { action: "followup", token: tokenId, version: 0, message: "This customer must not be able to create an admin follow-up.", nextFollowupAt: null, notify: true } })).status()).toBe(404);

    await customerPage.goto(`/dashboard/tracking?tokenId=${encodeURIComponent(tokenId)}`, { waitUntil: "domcontentloaded" });
    await expect(customerPage.getByRole("heading", { name: "Your service timeline", exact: true })).toBeVisible();
    await expect(customerPage.getByRole("article").getByText(token, { exact: true })).toBeVisible();
    await expect(customerPage.getByRole("list", { name: "Service progress", exact: true })).toBeVisible();
    await assertMobileLayout(customerPage, info, "tracking-390");
    await customerPage.setViewportSize({ width: 320, height: 740 });
    await assertMobileLayout(customerPage, info, "tracking-320");
    await customerPage.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => streamEvents.some(event => event.transport === "websocket" && event.name === "ready"), { message: "The authenticated WebSocket must be subscribed before sending the follow-up", timeout: 30_000 }).toBe(true);
    const updateCount = streamEvents.filter(event => event.transport === "websocket" && event.name === "update").length;

    await page.goto(`/admin/tokens?tokenId=${encodeURIComponent(tokenId)}`);
    await page.getByRole("button", { name: "Manage & follow up", exact: true }).click();
    const message = `QA arrival update ${stamp}: your professional will call before the confirmed appointment.`;
    await page.getByLabel("Customer follow-up", { exact: true }).fill(message);
    await expect(page.getByLabel("Send popup notification", { exact: true })).toBeChecked();
    const submitted = page.waitForResponse(response => response.url().endsWith("/api/admin/operations") && response.request().method() === "PATCH");
    await page.getByRole("button", { name: "Send follow-up", exact: true }).click();
    expect((await submitted).status()).toBe(200);
    await expect(page.getByRole("status").filter({ hasText: "Service updated" })).toBeVisible();
    await expect.poll(() => streamEvents.filter(event => event.transport === "websocket" && event.name === "update").length, { message: "The existing customer page must receive a real WebSocket update without reloading", timeout: 30_000 }).toBeGreaterThan(updateCount);
    const popup = customerPage.getByRole("dialog", { name: "An update on your service", exact: true });
    await expect(popup).toBeVisible();
    await expect(popup.getByText(message, { exact: true })).toBeVisible();
    await expect(popup.getByText(token, { exact: true })).toBeVisible();
    await assertMobileLayout(customerPage, info, "popup-390");
    await customerPage.setViewportSize({ width: 320, height: 740 });
    await assertMobileLayout(customerPage, info, "popup-320");
    await customerPage.setViewportSize({ width: 390, height: 844 });
    await customerPage.screenshot({ path: info.outputPath("customer-live-update-mobile.png"), fullPage: true });
    await page.screenshot({ path: info.outputPath("administrator-service-followup.png"), fullPage: true });

    const inbox = await (await customerContext.request.get("/api/notifications")).json();
    const notification = inbox.notifications.find((value: { message: string }) => value.message === message);
    expect(notification).toBeTruthy();
    expect((await (await outsiderContext.request.get("/api/notifications")).json()).notifications).toEqual([]);
    expect((await outsiderContext.request.patch("/api/notifications", { headers: origin, data: { id: notification.id, action: "read" } })).status()).toBe(404);

    const dismissed = customerPage.waitForResponse(response => response.url().endsWith("/api/notifications") && response.request().method() === "PATCH");
    await popup.getByRole("button", { name: "Read later", exact: true }).click();
    expect((await dismissed).status()).toBe(200);
    await expect(customerPage.locator('dialog[aria-labelledby="service-update-title"]')).toBeHidden();
    await expect(customerPage.getByRole("navigation", { name: "Primary mobile navigation" }).getByRole("link", { name: "Updates, 1 unread", exact: true })).toBeVisible();
    await customerPage.goto("/dashboard/updates");
    await expect(customerPage.getByText(message, { exact: true })).toBeVisible();
    await assertMobileLayout(customerPage, info, "inbox-390");
    await expect(customerPage.getByText("1 unread updates", { exact: true })).toBeVisible();
    const marked = customerPage.waitForResponse(response => response.url().endsWith("/api/notifications") && response.request().method() === "PATCH");
    await customerPage.getByRole("button", { name: "Mark as read", exact: true }).click();
    expect((await marked).status()).toBe(200);
    await expect(customerPage.getByText("0 unread updates", { exact: true })).toBeVisible();
    const finalInbox = await (await customerContext.request.get("/api/notifications")).json();
    const final = finalInbox.notifications.find((value: { id: string }) => value.id === notification.id);
    expect(final.read_at).toBeTruthy(); expect(final.popup_dismissed_at).toBeTruthy();
    await expect(customerPage.getByRole("navigation", { name: "Primary mobile navigation" }).getByRole("link", { name: "Updates", exact: true })).toBeVisible();

    // A disconnected tab must recover missed durable updates on WebSocket reconnect.
    const readyBeforeDisconnect = streamEvents.filter(event => event.transport === "websocket" && event.name === "ready").length;
    await customerContext.setOffline(true);
    expect(await customerPage.evaluate(() => navigator.onLine)).toBe(false);
    const reconnectMessage = `QA reconnect update ${stamp}: this follow-up was sent while your device was offline.`;
    await page.getByLabel("Customer follow-up", { exact: true }).fill(reconnectMessage);
    const sentOffline = page.waitForResponse(response => response.url().endsWith("/api/admin/operations") && response.request().method() === "PATCH");
    await page.getByRole("button", { name: "Send follow-up", exact: true }).click();
    expect((await sentOffline).status()).toBe(200);
    await expect(customerPage.locator('dialog[aria-labelledby="service-update-title"]')).toBeHidden();
    await customerContext.setOffline(false);
    await expect.poll(() => streamEvents.filter(event => event.transport === "websocket" && event.name === "ready").length, { message: "WebSocket must automatically reconnect after the customer regains connectivity", timeout: 30_000 }).toBeGreaterThan(readyBeforeDisconnect);
    await expect(customerPage.getByRole("dialog", { name: "An update on your service", exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(customerPage.getByRole("dialog", { name: "An update on your service", exact: true }).getByText(reconnectMessage, { exact: true })).toBeVisible({ timeout: 30_000 });
    await assertMobileLayout(customerPage, info, "reconnected-popup-390");
    await customerPage.screenshot({ path: info.outputPath("customer-reconnected-update.png"), fullPage: true });
    expect(errors).toEqual([]);
    await info.attach("redis-live-events", { body: JSON.stringify(streamEvents, null, 2), contentType: "application/json" });
  } finally {
    await customerContext.setOffline(false).catch(() => undefined);
    // Release only this test's future appointment; retain its audited history.
    if (bookingId) {
      const cancelled = await customerContext.request.patch(`/api/bookings/${bookingId}`, { headers: origin, data: { action: "cancel" } }).catch(() => null);
      await info.attach("operations-booking-cleanup", { body: `Created booking ${bookingId}: cancellation HTTP ${cancelled?.status() ?? "unavailable"}`, contentType: "text/plain" });
    }
    await customerContext.close(); await outsiderContext.close();
    if (administratorId) {
      await collection("sessions").deleteMany({ user_id: administratorId });
      await collection("users").updateOne({ id: administratorId }, { $set: { role: "customer" } });
      await collection("platform_account_status").updateOne({ user_id: administratorId }, { $set: { active: 0 } });
    }
    if (userIds.length) await collection("sessions").deleteMany({ user_id: { $in: userIds } });
    await closeRedis(); await closeMongo();
  }
});
