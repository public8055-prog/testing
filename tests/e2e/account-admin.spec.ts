import { test, expect, type BrowserContext } from "./fixtures";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

test.use({ actionTimeout: 30_000, navigationTimeout: 90_000 });

test("customer profile, saved services and support resolution through the administrator UI", async ({ page, browser, baseURL }, info) => {
  test.setTimeout(180_000);
  test.skip(!baseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname), "This trusted fixture requires a local test server.");
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  test.skip(!/^mongodb:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(process.env.MONGODB_URI||""), "Temporary role promotion is restricted to a local MongoDB test server.");
  const { getMongoDb, closeMongo } = await import("../../lib/mongo");
  const db = await getMongoDb();
  const stamp = randomUUID();
  const password = `QA-${randomUUID()}!`;
  const administrator = await browser.newContext({ baseURL });
  const adminEmail = `qa-account-admin-${stamp}@example.test`;
  const subject = `QA support ticket ${stamp}`;
  const responseText = "QA resolution: your profile details and saved service have been checked successfully.";
  const runtimeErrors: string[] = [];
  page.on("pageerror", error => runtimeErrors.push(error.message));
  let administratorId = "", complaintId = "", resolved = false;

  async function register(context: BrowserContext, name: string, email: string) {
    const response = await context.request.post("/api/auth/register", { headers: { Origin: baseURL! }, data: { name, email, password, termsAccepted:true,privacyConsent:true,adultConfirmed:true } });
    const body = await response.json();
    expect(response.status(), JSON.stringify(body)).toBe(201);
    return body.user.id as string;
  }
  const mutation = () => page.waitForResponse(response => response.url().endsWith("/api/platform") && response.request().method() === "POST");

  try {
    await register(page.context(), "QA Account Customer", `qa-account-customer-${stamp}@example.test`);
    administratorId = await register(administrator, "QA Account Administrator", adminEmail);
    // The local harness promotes only its own newly created account; the application has no role-escalation endpoint.
    await db.collection("users").updateOne({id:administratorId,email:adminEmail},{$set:{role:"ADMIN"}});
    await db.collection("sessions").deleteMany({user_id:administratorId});
    await administrator.clearCookies();
    const adminPage = await administrator.newPage();
    adminPage.on("pageerror", error => runtimeErrors.push(error.message));
    await adminPage.goto("/login");
    await adminPage.getByLabel("Email or login ID", {exact:true}).fill(adminEmail);
    await adminPage.getByLabel("Password", {exact:true}).fill(password);
    await adminPage.getByRole("button", {name:"Sign in",exact:true}).click();
    await expect(adminPage).toHaveURL(/\/admin\/dashboard$/);
    expect((await(await administrator.request.get("/api/auth/me")).json()).user.role).toBe("ADMIN");

    await page.goto("/dashboard/profile");
    await expect(page.getByRole("heading", { name: "Make yourself at home", exact: true })).toBeVisible();
    await page.getByLabel("Full name", { exact: true }).fill("QA Updated Customer");
    await page.getByLabel("Phone", { exact: true }).fill("9876543210");
    await page.getByLabel("Address", { exact: true }).fill("QA Apartment 7, Bengaluru 560001");
    const profileSaved = mutation();
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    expect((await profileSaved).status()).toBe(200);
    let customer = await (await page.request.get("/api/platform")).json();
    expect(customer.profile.address).toBe("QA Apartment 7, Bengaluru 560001");
    expect((await (await page.request.get("/api/auth/me")).json()).user.name).toBe("QA Updated Customer");

    const navigation = page.getByRole("navigation", { name: "Dashboard navigation", exact: true });
    await navigation.getByRole("link", { name: "Saved services", exact: true }).click();
    await expect(page.getByRole("heading", { name: "A little help, saved for later", exact: true })).toBeVisible();
    await page.locator('select[name="serviceSlug"]').selectOption("bathroom-deep-cleaning");
    const favoriteSaved = mutation();
    await page.getByRole("button", { name: "Save service", exact: true }).click();
    expect((await favoriteSaved).status()).toBe(200);
    customer = await (await page.request.get("/api/platform")).json();
    expect(customer.favorites).toHaveLength(1);
    expect(customer.favorites[0].slug).toBe("bathroom-deep-cleaning");
    await expect(page.getByRole("heading", { name: customer.favorites[0].title, exact: true })).toBeVisible();

    await navigation.getByRole("link", { name: "Updates & support", exact: true }).click();
    await expect(page.getByRole("heading", { name: "We’re here to help", exact: true })).toBeVisible();
    await page.getByLabel("Subject", { exact: true }).fill(subject);
    await page.getByLabel("How can we help?", { exact: true }).fill("This clearly labelled QA request checks that customers can receive a recorded support response.");
    const ticketSaved = mutation();
    await page.getByRole("button", { name: "Send support request", exact: true }).click();
    expect((await ticketSaved).status()).toBe(200);
    customer = await (await page.request.get("/api/platform")).json();
    complaintId = customer.complaints.find((ticket: { id: string; subject: string }) => ticket.subject === subject).id;
    expect((await page.request.get("/api/platform?admin=1")).status()).toBe(404);
    expect((await page.request.patch("/api/platform", { headers: { Origin: baseURL! }, data: { action: "complaint", id: complaintId, status: "resolved", response: "Unauthorised update must fail." } })).status()).toBe(404);

    await adminPage.goto("/admin/dashboard");
    await expect(adminPage.getByRole("heading", { name: "A clear view of your day", exact: true })).toBeVisible();
    await adminPage.getByRole("navigation", { name: "Administration navigation", exact: true }).getByRole("link", { name: "Support tickets", exact: true }).click();
    await expect(adminPage.getByRole("heading", { name: "Every concern deserves a response", exact: true })).toBeVisible();
    const ticket = adminPage.locator("form").filter({ has: adminPage.getByRole("heading", { name: subject, exact: true }) });
    await ticket.getByLabel("Response", { exact: true }).fill(responseText);
    await ticket.getByRole("combobox").selectOption("resolved");
    const responseSaved = adminPage.waitForResponse(response => response.url().endsWith("/api/platform") && response.request().method() === "PATCH");
    await ticket.getByRole("button", { name: "Save response", exact: true }).click();
    expect((await responseSaved).status()).toBe(200);
    resolved = true;
    await expect(adminPage.getByRole("status")).toContainText("recorded in the audit log");
    await adminPage.screenshot({ path: info.outputPath("admin-support-resolution.png"), fullPage: true, animations: "disabled" });

    await page.reload();
    const customerTicket = page.locator("article").filter({ has: page.getByRole("heading", { name: subject, exact: true }) });
    await expect(customerTicket.getByText(`Support response: ${responseText}`, { exact: true })).toBeVisible();
    await expect(customerTicket.getByText("resolved", { exact: true })).toBeVisible();
    const audit = await (await administrator.request.get("/api/platform?admin=1")).json();
    expect(audit.audit.some((entry: { action: string; target_id: string }) => entry.action === "complaint" && entry.target_id === complaintId)).toBe(true);
    expect(runtimeErrors).toEqual([]);
  } finally {
    if (complaintId && !resolved) await administrator.request.patch("/api/platform", { headers: { Origin: baseURL! }, data: { action: "complaint", id: complaintId, status: "resolved", response: "QA fixture cleanup: this automated test support request is closed." }, timeout: 5_000 }).catch(() => undefined);
    if (administratorId) {await db.collection("sessions").deleteMany({user_id:administratorId});await db.collection("users").updateOne({id:administratorId,email:adminEmail},{$set:{role:"CUSTOMER"}});}
    await administrator.close();
    await closeMongo();
  }
});
