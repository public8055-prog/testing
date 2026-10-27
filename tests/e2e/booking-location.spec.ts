import {test,expect} from "./fixtures";
import {randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import type {Document} from "mongodb";
import AxeBuilder from "@axe-core/playwright";

test("customer, assigned professional and admin share a private map while closing retains the final location",async({browser,baseURL},info)=>{
  test.setTimeout(240000);
  test.skip(!process.env.MONGODB_DB?.startsWith("urbankare_test_e2e_"),"Location acceptance requires an isolated QA database.");
  if(existsSync(".env.local"))process.loadEnvFile(".env.local");
  const {registerUser}=await import("../../lib/auth"),{createSessionTokens}=await import("../../lib/auth-sessions"),{getMongoDb,closeMongo}=await import("../../lib/mongo"),{closeRedis}=await import("../../lib/redis");
  const db=await getMongoDb(),rows=(name:string)=>db.collection<Document&{_id:string}>(name),stamp=randomUUID(),bookingId=`BK-${randomUUID()}`,providerId=randomUUID();
  const customerContext=await browser.newContext({baseURL,viewport:{width:320,height:740},permissions:["geolocation"],geolocation:{latitude:28.6139,longitude:77.209,accuracy:12}});
  const providerContext=await browser.newContext({baseURL,viewport:{width:390,height:844},permissions:["geolocation"],geolocation:{latitude:28.619,longitude:77.212,accuracy:15}});
  const adminContext=await browser.newContext({baseURL,viewport:{width:1280,height:900}}),outsider=await browser.newContext({baseURL});
  // Windows Playwright WebKit multiplies its emulated GPS timestamp by 1000.
  // Correct only that synthetic value in this fixture; production and server
  // freshness validation remain unchanged. Native device GPS is not certified here.
  if(browser.browserType().name()==="webkit")for(const context of [customerContext,providerContext])await context.addInitScript(()=>{
    const gps=navigator.geolocation;
    const normalize=(callback:PositionCallback):PositionCallback=>position=>{
      const timestamp=position.timestamp;
      callback(Math.abs(timestamp/1000-Date.now())<120000?{coords:position.coords,timestamp:timestamp/1000,toJSON:()=>({coords:position.coords.toJSON(),timestamp:timestamp/1000})}:position);
    };
    const watch=gps.watchPosition.bind(gps),current=gps.getCurrentPosition.bind(gps);
    gps.watchPosition=(success,error,options)=>watch(normalize(success),error,options);
    gps.getCurrentPosition=(success,error,options)=>current(normalize(success),error,options);
  });
  const customerPage=await customerContext.newPage(),providerPage=await providerContext.newPage(),adminPage=await adminContext.newPage();
  const errors:string[]=[];for(const page of [customerPage,providerPage,adminPage])page.on("pageerror",error=>errors.push(error.message));
  const accounts:string[]=[];
  const source=`/api/bookings/${bookingId}/location?source=catalog`,destination=`/locations/catalog/${bookingId}`,origin={Origin:baseURL!};
  try{
    const actors=[];
    for(const [role,context] of [["CUSTOMER",customerContext],["PROVIDER",providerContext],["SUPER_ADMIN",adminContext],["CUSTOMER",outsider]] as const){
      const user=await registerUser(`QA Map ${role}`,`map-${actors.length}-${stamp}@example.test`,`QA-${randomUUID()}!`);accounts.push(user.id);
      await rows("users").updateOne({id:user.id},{$set:{role,email_verified:1}});actors.push(user);
      const session=await createSessionTokens(user.id);await context.addCookies([{name:"urbankare_session",value:session.accessToken,url:baseURL!,httpOnly:true,sameSite:"Lax"},{name:"urbankare_refresh",value:session.refreshToken,url:baseURL!,httpOnly:true,sameSite:"Lax"}]);
    }
    const [customer,professional]=actors;
    await rows("marketplace_providers").insertOne({_id:providerId,id:providerId,user_id:professional.id,active:1,display_name:"QA Map Professional"});
    const now=new Date().toISOString();
    await rows("bookings").insertOne({_id:bookingId,id:bookingId,user_id:customer.id,name:customer.name,phone:"9876543210",address:"QA service address, New Delhi 110001",date:now.slice(0,10),slot:"11:00 AM",items:[],status:"confirmed",payment:"cash",payment_status:"unpaid",created_at:now,updated_at:now,total:100,subtotal:100,discount:0,visit_fee:0});
    await rows("service_tokens").insertOne({_id:`catalog:${bookingId}`,source:"catalog",booking_id:bookingId,customer_id:customer.id,token:"TKN-20261026-0001",assigned_provider_id:providerId,assigned_user_id:professional.id,version:0,created_at:now});
    expect((await outsider.request.get(source)).status()).toBe(404);
    expect((await customerContext.request.post(source,{headers:{Origin:"https://untrusted.example.test"},data:{action:"forget"}})).status()).toBe(403);
    const transport=await customerContext.request.get(source);expect(transport.headers()["cache-control"]).toContain("no-store");
    await customerPage.goto(destination);await expect(customerPage.getByRole("heading",{name:"Meet at the right place.",exact:true})).toBeVisible();
    await expect(customerPage.getByRole("navigation",{name:"Primary mobile navigation",exact:true}).getByRole("link",{name:"Activity",exact:true})).toHaveAttribute("aria-current","page");
    const gps=customerPage.getByRole("button",{name:"Share my live location",exact:true});await expect(gps).toBeDisabled();
    expect((await rows("booking_location_shares").countDocuments({booking_id:bookingId}))).toBe(0);
    await customerPage.getByRole("textbox",{name:"Landmark or arrival instructions",exact:true}).fill("QA map entrance at gate 2");
    await customerPage.getByRole("spinbutton",{name:"Service latitude",exact:true}).fill("28.6142");await customerPage.getByRole("spinbutton",{name:"Service longitude",exact:true}).fill("77.2094");
    await customerPage.getByRole("checkbox",{name:/I confirm this service address/}).check();await customerPage.getByRole("button",{name:"Save service address & pin",exact:true}).click();
    await expect(customerPage.getByRole("status")).toContainText("Service location saved");
    await customerPage.getByRole("checkbox",{name:/I agree to share my device/}).check();await gps.click();
    await expect.poll(async()=>{const data=await(await customerContext.request.get(source)).json();return data.customer.location.point?.latitude;}).toBe(28.6139);
    await providerPage.goto(destination);await expect(providerPage.getByText("Recent shared update",{exact:true})).toBeVisible();
    const directions=providerPage.getByRole("link",{name:"Navigate to service address",exact:true});await expect(directions).toHaveAttribute("href",/destination=28\.6142%2C77\.2094/);
    await providerPage.getByRole("checkbox",{name:/I agree to share my device/}).check();await providerPage.getByRole("button",{name:"Share my live location",exact:true}).click();
    await expect.poll(async()=>{const data=await(await customerContext.request.get(source)).json();return data.provider.location.point?.latitude;}).toBe(28.619);
    await adminPage.goto(destination);await expect(adminPage.getByRole("heading",{name:"Authorized administration view",exact:true})).toBeVisible();await expect(adminPage.getByRole("button",{name:"Share my live location",exact:true})).toHaveCount(0);
    expect((await adminContext.request.post(source,{headers:origin,data:{action:"start",sessionId:randomUUID(),consent:true}})).status()).toBe(403);
    await providerPage.getByRole("button",{name:"Load interactive map",exact:true}).click();const map=providerPage.getByRole("region",{name:/Booking map/});await expect(map).toBeVisible();await expect(map.getByRole("button",{name:"Zoom in",exact:true})).toBeVisible();
    await expect(map.locator(".leaflet-overlay-pane path").first()).toBeVisible();
    await expect.poll(()=>map.locator("img.leaflet-tile-loaded").evaluateAll(images=>images.some(image=>(image as HTMLImageElement).complete&&(image as HTMLImageElement).naturalWidth>0)),{timeout:30000}).toBe(true);
    const accessibility=await new AxeBuilder({page:customerPage}).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa"]).analyze();
    await info.attach("location-mobile-accessibility.json",{body:JSON.stringify(accessibility.violations),contentType:"application/json"});expect(accessibility.violations.map(row=>({id:row.id,nodes:row.nodes.map(node=>node.target)}))).toEqual([]);
    for(const page of [customerPage,providerPage])expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await providerPage.evaluate(()=>window.scrollTo(0,0));await providerPage.screenshot({path:info.outputPath("provider-map-390.png"),fullPage:true});
    await customerPage.goto("/dashboard");
    await expect.poll(async()=>{const data=await(await providerContext.request.get(source)).json();return data.customer.location.state;}).toBe("last_known");
    const stoppedNotification=providerPage.getByRole("dialog",{name:"Last shared location saved",exact:true});await expect(stoppedNotification).toBeVisible();await expect(stoppedNotification).toContainText("service address before travelling");await stoppedNotification.getByRole("button",{name:"Read later",exact:true}).click();
    const after=await(await providerContext.request.get(source)).json();expect(after.customer.location.point.latitude).toBe(28.6139);expect(after.address).toContain("110001");
    await customerPage.goto(destination);await expect(customerPage.getByText("Last known location",{exact:true})).toBeVisible();
    await customerPage.getByRole("button",{name:"Load interactive map",exact:true}).click();await expect(customerPage.locator(".leaflet-overlay-pane path").first()).toBeVisible();
    await customerPage.evaluate(()=>window.scrollTo(0,0));await customerPage.screenshot({path:info.outputPath("customer-last-location-320.png"),fullPage:true});
    customerPage.once("dialog",dialog=>dialog.accept());await customerPage.getByRole("button",{name:"Remove my saved GPS point",exact:true}).click();
    await expect.poll(async()=>{const data=await(await customerContext.request.get(source)).json();return data.customer.location.point;}).toBe(null);
    expect(errors).toEqual([]);
  }finally{
    await Promise.all([customerContext.close(),providerContext.close(),adminContext.close(),outsider.close()]);
    await rows("booking_location_shares").deleteMany({booking_id:bookingId});await rows("booking_location_sites").deleteMany({_id:`catalog:${bookingId}`});await rows("booking_location_access").deleteMany({booking_id:bookingId});
    await rows("service_tokens").deleteOne({_id:`catalog:${bookingId}`});await rows("bookings").deleteOne({id:bookingId});await rows("marketplace_providers").deleteOne({id:providerId});
    await rows("sessions").deleteMany({user_id:{$in:accounts}});await rows("users").deleteMany({id:{$in:accounts}});await closeRedis();await closeMongo();
  }
});

test("blocked GPS keeps the written address and manual pin usable, and maps wait for an explicit loading choice",async({page,baseURL},info)=>{
  test.setTimeout(180000);test.skip(!process.env.MONGODB_DB?.startsWith("urbankare_test_e2e_"),"Requires isolated QA data.");
  if(existsSync(".env.local"))process.loadEnvFile(".env.local");
  const {registerUser}=await import("../../lib/auth"),{createSessionTokens}=await import("../../lib/auth-sessions"),{getMongoDb,closeMongo}=await import("../../lib/mongo"),{closeRedis}=await import("../../lib/redis");
  const db=await getMongoDb(),id=`BK-${randomUUID()}`,user=await registerUser("QA Map Permission",`map-permission-${randomUUID()}@example.test`,`QA-${randomUUID()}!`),tokens=await createSessionTokens(user.id);
  const records=(name:string)=>db.collection<Document&{_id:string}>(name);let tileRequests=0;
  page.on("request",request=>{if(request.url().includes("tile.openstreetmap.org"))tileRequests++;});
  await page.context().addCookies([{name:"urbankare_session",value:tokens.accessToken,url:baseURL!,httpOnly:true,sameSite:"Lax"},{name:"urbankare_refresh",value:tokens.refreshToken,url:baseURL!,httpOnly:true,sameSite:"Lax"}]);
  await page.addInitScript(()=>{Object.defineProperty(navigator,"geolocation",{configurable:true,value:{watchPosition:(_success:unknown,error:(reason:unknown)=>void)=>{setTimeout(()=>error({code:1}),0);return 73;},clearWatch:()=>{},getCurrentPosition:(_success:unknown,error:(reason:unknown)=>void)=>error({code:1})}});});
  try{
    await records("bookings").insertOne({_id:id,id,user_id:user.id,name:user.name,address:"QA permission address, Delhi 110001",status:"confirmed",date:new Date().toISOString().slice(0,10),slot:"11:00 AM",items:[],payment:"cash",payment_status:"unpaid",total:100,created_at:new Date().toISOString()});
    await page.setViewportSize({width:320,height:740});await page.goto(`/locations/catalog/${id}`);
    await page.getByRole("checkbox",{name:/I agree to share my device/}).check();await page.getByRole("button",{name:"Share my live location",exact:true}).click();
    await expect(page.getByRole("alert").filter({hasText:"Location permission is blocked"})).toBeVisible();
    await expect.poll(async()=>Boolean((await records("booking_location_shares").findOne({booking_id:id}))?.sharing)).toBe(false);
    await page.getByRole("spinbutton",{name:"Service latitude",exact:true}).fill("28.61");await page.getByRole("spinbutton",{name:"Service longitude",exact:true}).fill("77.2");await page.getByRole("checkbox",{name:/I confirm this service address/}).check();await page.getByRole("button",{name:"Save service address & pin",exact:true}).click();
    await expect(page.getByRole("status")).toContainText("Service location saved");expect(tileRequests).toBe(0);
    await expect(page.getByRole("link",{name:"Navigate to service address",exact:true})).toHaveAttribute("href",/destination=28\.61%2C77\.2/);
    await page.route("https://tile.openstreetmap.org/**",route=>route.abort());await page.getByRole("button",{name:"Load interactive map",exact:true}).click();
    await expect(page.getByRole("alert").filter({hasText:"Map tiles could not load"})).toBeVisible();expect(tileRequests).toBeGreaterThan(0);
    await page.getByRole("button",{name:"Switch to dark mode",exact:true}).click();
    const results=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa"]).analyze();await info.attach("dark-location-map-accessibility.json",{body:JSON.stringify(results.violations),contentType:"application/json"});expect(results.violations.map(row=>({id:row.id,targets:row.nodes.map(node=>node.target)}))).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath("location-permission-denied-320-dark.png"),fullPage:true});
  }finally{await page.close();await records("booking_location_shares").deleteMany({booking_id:id});await records("booking_location_sites").deleteOne({_id:`catalog:${id}`});await records("bookings").deleteOne({id});await records("sessions").deleteMany({user_id:user.id});await records("users").deleteOne({id:user.id});await closeRedis();await closeMongo();}
});
