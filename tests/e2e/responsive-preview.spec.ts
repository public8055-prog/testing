import {test,expect} from "./fixtures";
test("homepage remains readable from small phones to desktop",async({page},info)=>{
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:900});await page.goto("/",{waitUntil:"domcontentloaded"});await expect(page.getByRole("heading",{level:1})).toBeVisible();
  const overflow=await page.evaluate(()=>({viewport:innerWidth,actual:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll("header *,main h1")].filter(el=>el.getBoundingClientRect().right>innerWidth+1).map(el=>el.textContent?.slice(0,40))}));
  expect(overflow.actual,JSON.stringify(overflow)).toBeLessThanOrEqual(width+1);
  if(width===1440)await page.screenshot({path:info.outputPath("homepage-desktop-viewport.png"),animations:"disabled"});
  if(width===390)await page.screenshot({path:info.outputPath("homepage-mobile-viewport.png"),animations:"disabled"});
 }
});
