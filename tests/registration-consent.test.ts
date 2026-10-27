import {strict as assert} from "node:assert";
import {test} from "node:test";
import {randomUUID} from "node:crypto";
import {mongoFixture} from "./helpers/mongo-fixture";
import {POST} from "../app/api/auth/register/route";
import {registerUser} from "../lib/auth";
import {REGISTRATION_POLICY_VERSION,type RegistrationConsent} from "../lib/consent";

test("registration API requires explicit policy and adult confirmations, and only actual consent is recorded",async()=>{
 const fixture=await mongoFixture("consent");process.env.REDIS_URL="redis://127.0.0.1:6380";
 const email=`consent-${randomUUID()}@example.test`,password=`QA-${randomUUID()}!`,details={name:"QA Consent",email,password};
 const accepted:RegistrationConsent={termsAccepted:true,privacyConsent:true,adultConfirmed:true};
 try{
  for(const flags of[{}, {...accepted,termsAccepted:false},{...accepted,privacyConsent:false},{...accepted,adultConfirmed:false},{termsAccepted:"true",privacyConsent:"true",adultConfirmed:"true"}]){
   const response=await POST(new Request("http://localhost:3000/api/auth/register",{method:"POST",headers:{Origin:"http://localhost:3000","Content-Type":"application/json"},body:JSON.stringify({...details,...flags})}));
   assert.equal(response.status,400);assert.match((await response.json()).error,/terms and privacy policy/);
  }
  assert.equal(await fixture.users.countDocuments({email}),0,"Rejected confirmations must not create an account.");
  assert.equal(await fixture.db.collection("user_consents").countDocuments(),0);
  const before=Date.now(),account=await registerUser(details.name,email,password,accepted),record=await fixture.db.collection("user_consents").findOne({user_id:account.id});
  assert.ok(record);assert.equal(record.policy_version,REGISTRATION_POLICY_VERSION);assert.equal(record.terms_version,REGISTRATION_POLICY_VERSION);assert.equal(record.privacy_version,REGISTRATION_POLICY_VERSION);assert.equal(record.terms_accepted,true);assert.equal(record.privacy_consent,true);assert.equal(record.adult_confirmed,true);assert.ok(Date.parse(record.recorded_at)>=before);
  assert.equal("password"in record,false);assert.equal("date_of_birth"in record,false);
  await assert.rejects(()=>registerUser(details.name,email,password,accepted),/already exists/);assert.equal(await fixture.db.collection("user_consents").countDocuments({user_id:account.id}),1);
  const internal=await registerUser("QA internal fixture",`internal-${randomUUID()}@example.test`,password);assert.equal(await fixture.db.collection("user_consents").countDocuments({user_id:internal.id}),0,"Internal fixtures and pre-existing accounts receive no invented consent record.");
 }finally{await fixture.close();}
});
