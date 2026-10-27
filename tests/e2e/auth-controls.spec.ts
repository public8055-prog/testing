import {test,expect} from "./fixtures";

test("password visibility works with keyboard controls without submitting credentials, and recovery reports its real availability",async({page})=>{
 const credentialWrites:string[]=[];
 page.on("request",request=>{if(request.url().includes("/api/auth/")&&["POST","PATCH"].includes(request.method()))credentialWrites.push(request.url());});
 for(const path of["/login","/register","/account"]){
  await page.goto(path);if(path==="/account")await expect(page).toHaveURL(/\/login$/);const password=page.getByLabel("Password",{exact:true});await expect(password).toHaveAttribute("type","password");await password.fill("UI-only-example-password!");
  const show=page.getByRole("button",{name:"Show password",exact:true});await expect(show).toHaveAttribute("aria-pressed","false");await show.focus();await page.keyboard.press("Space");
  await expect(password).toHaveAttribute("type","text");await expect(password).toHaveValue("UI-only-example-password!");const hide=page.getByRole("button",{name:"Hide password",exact:true});await expect(hide).toHaveAttribute("aria-pressed","true");await hide.click();await expect(password).toHaveAttribute("type","password");
  if(path!=="/register")await expect(page.getByRole("link",{name:"Forgot your password?",exact:true})).toBeVisible();
  else{await expect(page.getByRole("checkbox",{name:/I accept the Terms of Service/})).not.toBeChecked();await expect(page.getByRole("checkbox",{name:"I confirm that I am 18 years or older.",exact:true})).not.toBeChecked();}
 }
 const privateLogin=await page.goto("/admin/login");expect(privateLogin?.status()).toBe(404);await expect(page.getByLabel("Password",{exact:true})).toHaveCount(0);
 const capability=await page.request.get("/api/auth/password-reset");expect(capability.ok()).toBe(true);const{configured}=await capability.json();
 await page.goto("/login/reset");await expect(page.getByRole("heading",{name:"Forgot your password?",exact:true})).toBeVisible();
 if(configured)await expect(page.getByRole("button",{name:"Send recovery link",exact:true})).toBeVisible();else{await expect(page.getByText(/Password recovery is not available until/)).toBeVisible();await expect(page.getByRole("button",{name:"Send recovery link",exact:true})).toHaveCount(0);}
 // This non-existent token only renders the form; no reset or email request is sent.
 await page.goto(`/login/reset?token=${"0".repeat(64)}`);const replacement=page.getByLabel("New password",{exact:true});await replacement.fill("UI-only-new-password!");await page.getByRole("button",{name:"Show password",exact:true}).click();await expect(replacement).toHaveAttribute("type","text");await page.getByRole("button",{name:"Hide password",exact:true}).click();await expect(replacement).toHaveAttribute("type","password");
 expect(credentialWrites).toEqual([]);
});
