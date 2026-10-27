import test from "node:test";
import assert from "node:assert/strict";
import {NextRequest} from "next/server";
import {isBuiltinCatalog,isBuiltinPublicRead} from "../lib/runtime-config.mjs";
import {builtinCategories,builtinServices} from "../lib/builtin-catalog";
import {limitPublicRead} from "../lib/public-read-limit";
import {HttpError} from "../lib/http";
test("public catalogue is complete without Docker, MongoDB, Redis or signing credentials",async t=>{
  const previous={...process.env};process.env.CATALOG_SOURCE="builtin";process.env.MONGODB_URI="";process.env.REDIS_URL="";process.env.AUTH_JWT_SECRET="";process.env.VERCEL="1";process.env.APP_URL="http://localhost:3000";
  t.after(()=>{for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);});
  await t.test("automatic selection detects absent and Vercel loopback services without masking configured database mode",()=>{
    assert.equal(isBuiltinCatalog({}),true);assert.equal(isBuiltinCatalog({CATALOG_SOURCE:"database"}),false);
    const cloud={MONGODB_URI:"mongodb+srv://cluster.example.test/app",REDIS_URL:"rediss://redis.example.test:6380",VERCEL:"1"};
    assert.equal(isBuiltinCatalog(cloud),false);assert.equal(isBuiltinCatalog({...cloud,MONGODB_URI:"mongodb://127.0.0.1:27018/"}),true);
    assert.equal(isBuiltinCatalog({...cloud,MONGODB_URI:"mongodb://localhost:password@cluster.example.test/app"}),false);
    assert.throws(()=>isBuiltinCatalog({CATALOG_SOURCE:"invalid"}),/CATALOG_SOURCE/);
  });
  await t.test("all twelve categories and forty-eight service records have valid links and accurate counts",()=>{
    const categories=builtinCategories(),services=builtinServices();assert.equal(categories.length,12);assert.equal(services.length,48);assert.equal(new Set(services.map(s=>s.slug)).size,services.length);
    for(const category of categories){assert.equal(category.servicesCount,services.filter(s=>s.category===category.slug).length);assert.ok(category.servicesCount>=0);}
    for(const service of services){assert.ok(categories.some(c=>c.slug===service.category));assert.ok(service.price>0&&service.includes.length&&service.faqs.length);assert.equal(service.rating,0);assert.equal(service.reviews,0);assert.equal(service.mrp,service.price);}
    services[0].includes.length=0;assert.ok(builtinServices()[0].includes.length);
  });
  await t.test("public repositories and APIs resolve built-in content without a database connection",async()=>{
    const db=await import("../lib/db"),platform=await import("../lib/platform"),market=await import("../lib/marketplace"),categories=await import("../lib/marketplace-categories");
    assert.equal((await db.readServices()).length,48);assert.equal((await db.readCategories()).length,12);assert.equal((await categories.readMarketplaceCategories()).length,12);
    const first=builtinServices()[0];assert.equal((await db.getCatalogService(first.slug))?.title,first.title);assert.equal(await db.getCatalogService("not-present"),null);assert.deepEqual(await db.readServices("not-present"),[]);
    assert.deepEqual(await platform.readPlatformConfig(),{});assert.deepEqual(await platform.getActiveBanners(),[]);assert.equal((await market.listMarketplaceProviders()).count,0);assert.deepEqual(await db.readProfessionals(),[]);
    const api=await import("../app/api/services/route"),health=await import("../app/api/health/route"),me=await import("../app/api/auth/me/route");
    const response=await api.GET(new Request("https://urbankare.vercel.app/api/services?limit=100"));assert.equal(response.status,200);assert.equal((await response.json()).total,48);assert.match(response.headers.get("cache-control")!,/s-maxage=300/);
    assert.equal((await(await health.GET()).json()).operations,"not-configured");assert.equal((await(await me.GET(new Request("https://urbankare.vercel.app/api/auth/me",{headers:{Cookie:"urbankare_session=forged"}}))).json()).user,null);
  });
  await t.test("proxy permits public browsing and same-origin preflight while denying every operational write",async()=>{
    const {proxy}=await import("../proxy");
    const request=(path:string,method="GET",origin?:string)=>new NextRequest(`https://urbankare.vercel.app${path}`,{method,headers:{"x-forwarded-for":"198.18.0.77",...(origin?{Origin:origin}:{})}});
    assert.equal((await proxy(request("/api/services"))).headers.get("x-middleware-next"),"1");
    assert.equal((await proxy(request("/api/services","OPTIONS","https://urbankare.vercel.app"))).status,204);
    assert.equal((await proxy(request("/api/services","GET","https://untrusted.example.test"))).status,403);
    for(const path of ["/api/bookings","/api/auth/login","/api/quote","/api/payments/orders","/api/provider/documents"]){const result=await proxy(request(path,"POST"));assert.equal(result.status,503);assert.equal((await result.json()).code,"OPERATIONS_NOT_CONFIGURED");}
    assert.equal((await proxy(request("/api/admin/providers","POST"))).status,404);assert.equal((await proxy(request("/admin/providers"))).status,404);assert.equal((await proxy(request("/.env.local"))).status,404);
    assert.equal(isBuiltinPublicRead("/api/services/admin/users","GET"),false);assert.equal(isBuiltinPublicRead("/api/services","POST"),false);
  });
  await t.test("public-only limiter has a bounded sliding window and private reads never use its allowlist",()=>{
    for(let i=0;i<100;i++)limitPublicRead("qa-limit",1000000);assert.throws(()=>limitPublicRead("qa-limit",1000000),(error:unknown)=>error instanceof HttpError&&error.status===429&&error.retryAfter===60);
    assert.doesNotThrow(()=>limitPublicRead("qa-limit",1060001));assert.equal(isBuiltinPublicRead("/api/provider/documents","GET"),false);
  });
});
