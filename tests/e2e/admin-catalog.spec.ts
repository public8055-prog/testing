import {test,expect} from "./fixtures";
import {randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import type {Document} from "mongodb";

test("shared sign-in routes a seeded administrator to service and banner management",async({page,baseURL})=>{
 test.setTimeout(120_000);
 test.skip(!baseURL||!["localhost","127.0.0.1","[::1]"].includes(new URL(baseURL).hostname),"Trusted bootstrap fixtures run only against local servers.");
 if(existsSync(".env.local"))process.loadEnvFile(".env.local");
 test.skip(!/^mongodb:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(process.env.MONGODB_URI||""),"This fixture requires local MongoDB.");
 const {bootstrapAdministrator}=await import("../../lib/admin-bootstrap"),{getMongoDb,closeMongo}=await import("../../lib/mongo"),{closeRedis}=await import("../../lib/redis");
 const {adminMutation}=await import("../../lib/platform"),db=await getMongoDb(),c=(name:string)=>db.collection<Document&{_id:string}>(name);
 const stamp=randomUUID(),alias=`qa-admin-${stamp}#example.test`,password=`QA-${randomUUID()}!`,slug=`qa-service-${stamp}`,serviceTitle=`QA service ${stamp}`,bannerTitle=`QA banner ${stamp}`;
 let administratorId="",bannerId="";
 const mutation=()=>page.waitForResponse(r=>r.url().endsWith("/api/platform")&&r.request().method()==="PATCH");
 page.on("dialog",dialog=>dialog.accept());
 try{
  administratorId=(await bootstrapAdministrator(alias,password,"QA Catalogue Administrator")).id;
  await page.goto("/login");await page.getByLabel("Email or login ID",{exact:true}).fill(alias);await page.getByLabel("Password",{exact:true}).fill(password);await page.getByRole("button",{name:"Sign in",exact:true}).click();await expect(page).toHaveURL(/\/admin\/dashboard$/);
  expect((await(await page.request.get("/api/auth/me")).json()).user.role).toBe("SUPER_ADMIN");
  const initial=await(await page.request.get("/api/platform?admin=1")).json();const category=initial.categories.find((c:{active?:boolean;archived?:boolean})=>c.active!==false&&!c.archived);expect(category).toBeTruthy();
  await page.goto("/admin/services");await page.getByRole("button",{name:"Create service",exact:true}).click();await page.getByLabel("Service name",{exact:true}).fill(serviceTitle);await page.getByLabel("URL name",{exact:false}).fill(slug);await page.getByLabel("Service category",{exact:true}).selectOption(category.slug);await page.getByLabel("Price (₹)",{exact:true}).fill("321");await page.getByLabel("Description",{exact:true}).fill("This clearly labelled QA service verifies catalogue administration.");await page.getByLabel("What’s included (one item per line)",{exact:true}).fill("QA scope verification");
  const created=mutation();await page.getByRole("button",{name:"Save service",exact:true}).click();expect((await created).status()).toBe(200);await page.getByLabel("Search services",{exact:true}).fill(serviceTitle);await expect(page.getByRole("heading",{name:serviceTitle,exact:true})).toBeVisible();expect((await c("services").findOne({slug}))!.price).toBe(321);
  const removed=mutation();await page.getByRole("button",{name:`Delete ${serviceTitle}`,exact:true}).click();expect((await removed).status()).toBe(200);await expect(page.getByText("Deleted · history retained",{exact:true})).toBeVisible();expect((await c("services").findOne({slug}))!.deleted).toBe(true);
  await page.goto("/admin/banners");await page.getByRole("button",{name:"Create banner",exact:true}).click();await page.getByLabel("Title",{exact:true}).fill(bannerTitle);await page.getByLabel("Image URL",{exact:true}).fill(`${baseURL}/favicon.ico`);await page.getByLabel("Description",{exact:true}).fill("This clearly labelled QA announcement verifies the banner editor.");await page.getByLabel("Active within scheduled dates",{exact:true}).check();
  const bannerSaved=mutation();await page.getByRole("button",{name:"Save banner",exact:true}).click();expect((await bannerSaved).status()).toBe(200);await expect(page.getByRole("heading",{name:bannerTitle,exact:true})).toBeVisible();bannerId=String((await c("platform_banners").findOne({title:bannerTitle}))!.id);
  const bannerRemoved=mutation();await page.getByRole("button",{name:`Delete ${bannerTitle}`,exact:true}).click();expect((await bannerRemoved).status()).toBe(200);await expect(page.getByRole("heading",{name:bannerTitle,exact:true})).toHaveCount(0);expect((await c("platform_banners").findOne({id:bannerId}))!.deleted).toBe(true);
  await page.goto("/admin/payments");await expect(page.getByRole("heading",{name:"Every transaction, accounted for",exact:true})).toBeVisible();
 }finally{
  if(administratorId){const actor={id:administratorId,role:"SUPER_ADMIN"};if(await c("services").findOne({slug,deleted:{$ne:true}}))await adminMutation(actor,{action:"service-delete",slug});if(bannerId&&await c("platform_banners").findOne({id:bannerId,deleted:{$ne:true}}))await adminMutation(actor,{action:"banner-delete",id:bannerId});await c("sessions").deleteMany({user_id:administratorId});await c("users").updateOne({id:administratorId},{$set:{role:"CUSTOMER"}});await c("platform_account_status").updateOne({user_id:administratorId},{$set:{active:0}});}
  await closeRedis();await closeMongo();
 }
});
