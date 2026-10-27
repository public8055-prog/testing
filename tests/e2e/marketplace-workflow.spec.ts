import { test, expect, type BrowserContext } from "./fixtures";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

test.use({actionTimeout:60000,navigationTimeout:120000});

test("provider application, administrator approval, customer booking, conflicts and owner isolation",async({page,browser,baseURL},info)=>{
  test.setTimeout(600000);
  test.skip(!baseURL||!["localhost","127.0.0.1","[::1]"].includes(new URL(baseURL).hostname),"This trusted database fixture is restricted to a local test server.");
  if(existsSync(".env.local"))process.loadEnvFile(".env.local");
  const {getMongoDb,closeMongo}=await import("../../lib/mongo");
  const users=(await getMongoDb()).collection("users");
  const stamp=Date.now().toString();
  const professionalName="QA Professional "+stamp;
  const password="QA-"+randomUUID()+"!";
  const provider=await browser.newContext({baseURL});
  const admin=await browser.newContext({baseURL});
  const outsider=await browser.newContext({baseURL});
  let providerId="",bookingId="",adminUserId="";
  const errors:string[]=[];
  page.on("pageerror",e=>errors.push(e.message));
  async function register(context:BrowserContext,name:string,emailPrefix:string){
    const response=await context.request.post("/api/auth/register",{headers:{Origin:baseURL!},data:{name,email:`${emailPrefix}-${stamp}@example.test`,password,termsAccepted:true,privacyConsent:true,adultConfirmed:true},timeout:90000});
    const body=await response.json();expect(response.status(),JSON.stringify(body)).toBe(201);return body.user.id as string;
  }
  try {
    await register(provider,professionalName,"qa-marketplace-provider");
    adminUserId=await register(admin,"QA Marketplace Administrator","qa-marketplace-admin");
    // The test harness promotes only its just-created QA account. The app never exposes role escalation.
    await users.updateOne({id:adminUserId,email:`qa-marketplace-admin-${stamp}@example.test`},{$set:{role:"ADMIN"}});
    await register(page.context(),"QA Marketplace Customer","qa-marketplace-customer");
    await register(outsider,"QA Unrelated Customer","qa-marketplace-outsider");
    const professionalPage=await provider.newPage();
    professionalPage.on("pageerror",e=>errors.push(e.message));
    await test.step("Professional submits a real profile application",async()=>{
      await professionalPage.goto("/provider/profile");
      await professionalPage.getByLabel("Display name",{exact:true}).fill(professionalName);
      await professionalPage.getByLabel("Primary service",{exact:true}).selectOption("Housekeeping");
      await professionalPage.getByLabel("City / service area",{exact:true}).fill("Bengaluru");
      await professionalPage.getByLabel("Years of experience",{exact:true}).fill("4");
      await professionalPage.getByLabel("About your services",{exact:true}).fill("Clearly labelled QA provider application for testing careful home organization and housekeeping.");
      await professionalPage.getByLabel("Skills (separated by commas)",{exact:true}).fill("Housekeeping, organizing");
      await professionalPage.getByLabel("Per hour (₹)",{exact:true}).fill("300");
      await professionalPage.getByLabel("Per day (₹)",{exact:true}).fill("1800");
      await professionalPage.getByLabel("Per month (₹)",{exact:true}).fill("22000");
      const responsePromise=professionalPage.waitForResponse(r=>r.url().endsWith("/api/marketplace/profile")&&r.request().method()==="POST");
      await professionalPage.getByRole("button",{name:"Save & submit for review",exact:true}).click();
      const response=await responsePromise;const body=await response.json();expect(response.status(),JSON.stringify(body)).toBe(200);providerId=body.provider.id;
      await expect(professionalPage.getByRole("status").filter({hasText:"submitted for administrator review"})).toContainText("submitted for administrator review");
      expect(body.provider.active).toBe(0);
    });
    await test.step("Only the administrator can review private documents and publish the profile",async()=>{
      const data={action:"provider",id:providerId,active:true};
      expect((await provider.request.patch("/api/platform",{headers:{Origin:baseURL!},data})).status()).toBe(404);
      expect((await admin.request.patch("/api/platform",{headers:{Origin:baseURL!},data})).status()).toBe(409);
      const uploaded=await provider.request.post("/api/uploads",{headers:{Origin:baseURL!},multipart:{purpose:"provider-document",documentType:"identity",file:{name:"qa-marketplace-identity.png",mimeType:"image/png",buffer:await (await import("sharp")).default({create:{width:100,height:100,channels:3,background:"#386477"}}).png().toBuffer()}}});expect(uploaded.status(),await uploaded.text()).toBe(201);const upload=await uploaded.json();
      const submitted=await provider.request.post("/api/provider/documents",{headers:{Origin:baseURL!},data:{uploadId:upload.id,identityKind:"masked_aadhaar",consent:true,redacted:true}});expect(submitted.status(),await submitted.text()).toBe(200);
      expect((await outsider.request.get(upload.url)).status()).toBe(404);
      const documents=await(await provider.request.get("/api/provider/documents")).json();expect(documents.documents).toHaveLength(1);
      const reviewed=await admin.request.patch("/api/platform",{headers:{Origin:baseURL!},data:{action:"provider-document-review",id:documents.documents[0].id,status:"approved",identityChecked:true,reason:"QA marketplace identity document reviewed."}});expect(reviewed.status(),await reviewed.text()).toBe(200);
      const response=await admin.request.patch("/api/platform",{headers:{Origin:baseURL!},data:{action:"provider-status",id:providerId,status:"approved",reason:"QA marketplace application and documents approved."}});expect(response.status(),await response.text()).toBe(200);
      await page.goto(`/services?category=housekeeping&q=${encodeURIComponent(professionalName)}`);
      await expect(page.getByRole("heading",{name:professionalName,exact:true})).toBeVisible();
      await page.getByRole("link",{name:"View profile",exact:true}).click();
      await expect(page.getByRole("heading",{name:professionalName,exact:true})).toBeVisible();
      await expect(page.getByText("Verification checks completed",{exact:true})).toBeVisible();
      await page.screenshot({path:info.outputPath("provider-profile-desktop.png"),fullPage:true,animations:"disabled"});
    });
    const requestedDate=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
    await test.step("Customer sends a booking through every UI step",async()=>{
      await page.getByRole("link",{name:"Request a booking",exact:true}).click();
      await page.getByRole("button",{name:"Continue",exact:true}).click();
      await page.getByLabel("Service date",{exact:true}).fill(requestedDate);
      await page.getByLabel("Start time",{exact:true}).selectOption("10:00");
      await page.getByLabel("Service address",{exact:true}).fill("QA Apartment 10, Bengaluru 560001");
      await page.getByLabel("What would you like help with?",{exact:true}).fill("QA booking to verify housekeeping and room organization.");
      await page.getByRole("button",{name:"Continue",exact:true}).click();
      await page.getByRole("checkbox").check();
      const responsePromise=page.waitForResponse(r=>r.url().endsWith("/api/marketplace/bookings")&&r.request().method()==="POST");
      await page.getByRole("button",{name:"Send booking request",exact:true}).click();
      const response=await responsePromise;const body=await response.json();expect(response.status(),JSON.stringify(body)).toBe(201);bookingId=body.id;
      await expect(page.getByRole("heading",{name:"One less thing on your list.",exact:true})).toBeVisible();
      await page.screenshot({path:info.outputPath("marketplace-booking-confirmation.png"),fullPage:true,animations:"disabled"});
      const details=await page.request.get(`/api/marketplace/bookings/${bookingId}`);expect(details.status()).toBe(200);const booking=(await details.json()).booking;expect(booking.total).toBe(600);expect(booking.payment_status).toBe("pending");
    });
    await test.step("Conflicts and unauthorized access are rejected server-side",async()=>{
      const response=await page.request.post("/api/marketplace/bookings",{headers:{Origin:baseURL!},data:{provider_id:providerId,kind:"hourly",date:requestedDate,time:"10:00",hours:2,address:"QA Apartment 10, Bengaluru 560001",requirements:"QA second request for an already reserved visit.",terms:true,request_key:randomUUID(),expected_total:600}});
      expect(response.status(),await response.text()).toBe(409);
      expect((await outsider.request.get(`/api/marketplace/bookings/${bookingId}`)).status()).toBe(404);
      expect((await outsider.request.patch(`/api/marketplace/bookings/${bookingId}`,{headers:{Origin:baseURL!},data:{status:"cancelled"}})).status()).toBe(404);
      expect((await page.request.post("/api/marketplace/reviews",{headers:{Origin:baseURL!},data:{booking_id:bookingId,rating:5,body:"This is not yet a completed booking."}})).status()).toBe(403);
    });
    await test.step("Professional accepts the request and the customer can cancel",async()=>{
      await professionalPage.goto("/provider/requests");
      await expect(professionalPage.locator("table").getByText("QA Marketplace Customer",{exact:true})).toBeVisible();
      const accepted=professionalPage.waitForResponse(r=>r.url().endsWith(`/api/marketplace/bookings/${bookingId}`)&&r.request().method()==="PATCH");
      await professionalPage.getByRole("button",{name:"Accept",exact:true}).click();expect((await accepted).status()).toBe(200);
      await professionalPage.goto("/provider/bookings");
      await expect(professionalPage.locator("table").getByText("confirmed",{exact:true})).toBeVisible();
      await professionalPage.screenshot({path:info.outputPath("provider-bookings.png"),fullPage:true,animations:"disabled"});
      await professionalPage.setViewportSize({width:390,height:844});
      await expect(professionalPage.getByText("confirmed",{exact:true}).filter({visible:true})).toBeVisible();
      expect(await professionalPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      await professionalPage.screenshot({path:info.outputPath("provider-bookings-mobile.png"),fullPage:true,animations:"disabled"});
      const response=await page.request.patch(`/api/marketplace/bookings/${bookingId}`,{headers:{Origin:baseURL!},data:{status:"cancelled"}});expect(response.status()).toBe(200);
    });
    await test.step("Marketplace mobile layout stays within the viewport",async()=>{
      await page.setViewportSize({width:390,height:844});
      await page.goto(`/services?category=housekeeping&q=${encodeURIComponent(professionalName)}`);
      const sizes=await page.evaluate(()=>({page:document.documentElement.scrollWidth,screen:innerWidth}));expect(sizes.page).toBeLessThanOrEqual(sizes.screen+1);
      await page.screenshot({path:info.outputPath("marketplace-mobile.png"),fullPage:true,animations:"disabled"});
    });
    expect(errors).toEqual([]);
  }finally{
    if(bookingId)await page.request.patch(`/api/marketplace/bookings/${bookingId}`,{headers:{Origin:baseURL!},data:{status:"cancelled"},timeout:15000}).catch(()=>undefined);
    if(providerId)await admin.request.patch("/api/platform",{headers:{Origin:baseURL!},data:{action:"provider",id:providerId,active:false},timeout:15000}).catch(()=>undefined);
    // Revoke the temporary QA administrator privilege even when a browser assertion fails.
    if(adminUserId)await users.updateOne({id:adminUserId,email:`qa-marketplace-admin-${stamp}@example.test`},{$set:{role:"CUSTOMER"}});
    await Promise.all([provider.close(),admin.close(),outsider.close()]);await closeMongo();
  }
});
