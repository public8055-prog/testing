import { test, expect as baseExpect } from "./fixtures";

const expect=baseExpect.configure({timeout:90_000});

test("committed workforce saves survive a failed refresh without repeating the mutation",async({page,baseURL})=>{
  test.setTimeout(300_000);
  const stamp=Date.now(),email=`wf-refresh-${stamp}@example.test`;
  const registration=await page.request.post("/api/auth/register",{headers:{Origin:baseURL!},timeout:90_000,data:{name:"Refresh Test Owner",email,password:"Local-workforce-refresh-passphrase!",termsAccepted:true,privacyConsent:true,adultConfirmed:true}});
  expect(registration.status(),await registration.text()).toBe(201);

  let failNextRead=true,snapshotReads=0;
  const posts:Record<string,number>={};
  await page.route("**/api/workforce**",async route=>{
    const request=route.request();
    if(new URL(request.url()).pathname!=="/api/workforce")return route.continue();
    if(request.method()==="POST"){
      const action=String(request.postDataJSON().action);
      posts[action]=(posts[action]||0)+1;
    }
    if(request.method()==="GET"){
      snapshotReads++;
      if(failNextRead){
        failNextRead=false;
        return route.fulfill({status:500,contentType:"application/json",body:JSON.stringify({error:"Injected snapshot outage"})});
      }
    }
    await route.continue();
  });
  const savedNotice=page.getByRole("alert").filter({hasText:"Your changes are already saved."});
  const refreshButton=page.getByRole("button",{name:"Refresh workspace",exact:true});
  async function submitMutation(action:string,submit:()=>Promise<void>,expectedStatus=200){
    const pendingResponse=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/workforce"&&response.request().method()==="POST"&&response.request().postDataJSON().action===action,{timeout:90_000});
    await submit();
    const response=await pendingResponse;
    expect(response.status(),`${action}: HTTP ${response.status()} ${await response.text()}`).toBe(expectedStatus);
  }

  // A committed workspace must not leave an enabled creation form after a read failure.
  await page.goto("/business/dashboard",{waitUntil:"domcontentloaded"});
  await page.getByLabel("Business or household name").fill(`Refresh workspace ${stamp}`);
  await submitMutation("create-business",()=>page.getByRole("button",{name:"Create workspace",exact:true}).click());
  await expect(savedNotice).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Your business workspace is ready.");
  await expect(page.getByRole("button",{name:"Create workspace",exact:true})).toBeDisabled();
  expect(posts["create-business"]).toBe(1);
  const createReadCount=snapshotReads;
  await refreshButton.click();
  await expect(page.getByRole("heading",{name:"Welcome back, Refresh"})).toBeVisible();
  await expect(savedNotice).toHaveCount(0);
  expect(snapshotReads).toBe(createReadCount+1);
  expect(posts["create-business"]).toBe(1);

  await page.goto("/business/workers",{waitUntil:"domcontentloaded"});
  await page.getByRole("button",{name:"Add team member",exact:true}).click();
  await page.getByRole("dialog").getByLabel("Full name").fill("Saved team member");
  await page.getByRole("dialog").getByLabel("Account email (optional)").fill(email);
  failNextRead=true;
  await submitMutation("add-worker",()=>page.getByRole("dialog").getByRole("button",{name:"Save changes"}).click());
  await expect(savedNotice).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Worker added and their account linked.");
  await expect(page.getByRole("button",{name:"Add team member",exact:true})).toBeDisabled();
  expect(posts["add-worker"]).toBe(1);

  const workerReadCount=snapshotReads;
  await refreshButton.click();
  await expect(page.getByRole("heading",{name:"Saved team member",exact:true})).toBeVisible();
  await expect(page.getByText("Account linked · self check-in enabled")).toBeVisible();
  await expect(savedNotice).toHaveCount(0);
  await expect(refreshButton).toHaveCount(0);
  expect(snapshotReads).toBe(workerReadCount+1);
  expect(posts["add-worker"],"Read recovery must never resubmit the committed worker mutation").toBe(1);

  // A genuinely rejected write still keeps the user's form values editable.
  await page.getByRole("button",{name:"Add team member",exact:true}).click();
  await page.getByRole("dialog").getByLabel("Full name").fill("Preserve my entered name");
  await page.getByRole("dialog").getByLabel("Account email (optional)").fill(email);
  await submitMutation("add-worker",()=>page.getByRole("dialog").getByRole("button",{name:"Save changes"}).click(),409);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("This worker is already active in your workspace.");
  await expect(page.getByRole("dialog").getByLabel("Full name")).toHaveValue("Preserve my entered name");
  await expect(page.getByRole("dialog").getByRole("button",{name:"Save changes"})).toBeEnabled();
  await expect(savedNotice).toHaveCount(0);
  expect(posts["add-worker"]).toBe(2);
});
