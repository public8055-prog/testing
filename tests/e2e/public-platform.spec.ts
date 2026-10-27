import {test,expect} from "./fixtures";

test("public pages, responsive navigation, images and protected routes work",async({page,request},info)=>{
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto("/",{waitUntil:"domcontentloaded"});
 await expect(page.getByRole("heading",{level:1})).toContainText("Local home");
 await expect(page.locator(".category-card")).toHaveCount(8);
 await expect(page.locator(".hero-photo-main img")).toBeVisible();
 await expect.poll(()=>page.locator(".hero-photo-main img").evaluate((el:HTMLImageElement)=>el.complete&&el.naturalWidth>0)).toBe(true);
 await page.screenshot({path:info.outputPath("homepage-desktop.png"),fullPage:true,animations:"disabled"});
 for(const route of ["/how-it-works","/for-businesses","/become-a-provider","/pricing","/about","/contact","/privacy","/terms","/services","/login","/register"]){
   const response=await page.goto(route,{waitUntil:"domcontentloaded"});expect(response?.status(),route).toBe(200);
   await expect(page.getByRole("heading",{level:1})).toBeVisible();
 }
 for(const path of ["/api/marketplace/bookings","/api/workforce","/api/platform"]){expect((await request.get(path)).status(),path).toBe(401);}
 expect((await request.get("/api/admin/bookings")).status()).toBe(404);
 for(const route of ["/dashboard","/dashboard/favorites","/provider/dashboard","/business/dashboard"]){await page.goto(route,{waitUntil:"domcontentloaded"});await expect(page).toHaveURL(/\/login\?next=/);}
 for(const route of ["/admin/dashboard","/admin/providers","/admin/login"]){expect((await page.goto(route,{waitUntil:"domcontentloaded"}))?.status(),route).toBe(404);await expect(page.getByLabel("Password",{exact:true})).toHaveCount(0);}
 await page.setViewportSize({width:390,height:844});
 for(const route of ["/","/services","/for-businesses","/pricing","/contact","/register"]){await page.goto(route,{waitUntil:"domcontentloaded"});await expect(page.getByRole("heading",{level:1})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),route).toBe(true);}
 await page.goto("/",{waitUntil:"domcontentloaded"});await page.screenshot({path:info.outputPath("homepage-mobile.png"),fullPage:true,animations:"disabled"});
 await page.getByRole("button",{name:"Open navigation",exact:true}).click();await expect(page.getByRole("navigation",{name:"More navigation",exact:true})).toBeVisible();await page.getByRole("navigation",{name:"More navigation",exact:true}).getByRole("link",{name:"For businesses",exact:true}).click();await expect(page).toHaveURL(/\/for-businesses$/);
 await page.goto("/does-not-exist",{waitUntil:"domcontentloaded"});await expect(page.getByRole("heading",{name:"This page has moved out."})).toBeVisible();
 expect(errors).toEqual([]);
});

