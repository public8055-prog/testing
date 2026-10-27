import { z } from "zod";
import type { ClientSession, Document } from "mongodb";
import { getMongoDb } from "./mongo";
import { HttpError } from "./http";
import { randomUUID } from "node:crypto";
import { withMongoTransaction } from "./mongo";
export const identityKinds = ["masked_aadhaar", "driving_licence", "passport", "voter_id"] as const;
export const IDENTITY_POLICY_VERSION = "2026-10-27";
export const identitySubmissionSchema = z.object({ identityKind: z.enum(identityKinds), consent: z.literal(true), redacted: z.literal(true) });
export type IdentitySubmission = z.infer<typeof identitySubmissionSchema>;
export function validateIdentitySubmission(input: unknown, upload: { mimeType: string; documentType?: string }) {
  const result = identitySubmissionSchema.safeParse(input);
  if (!result.success) throw new HttpError(400, "Choose a government photo ID, confirm consent and mask unnecessary identity numbers and QR/barcodes.");
  if (upload.documentType !== "identity" || !["image/webp", "image/png", "image/jpeg"].includes(upload.mimeType)) throw new HttpError(400, "Identity evidence must be a JPEG, PNG or WebP photo, not a PDF.");
  return result.data;
}
export async function approvedIdentityDocuments(providerId: string, session: ClientSession) {
  const db = await getMongoDb(), documents = await db.collection<Document>("platform_provider_documents").find({ provider_id: providerId, superseded: { $ne: true } }, { session }).toArray();
  const identity = documents.find(d => d.document_type === "identity" && d.status === "approved" && identityKinds.includes(d.identity_kind) && d.consent_version === IDENTITY_POLICY_VERSION && d.redacted === true && d.identity_checked === true);
  const upload = identity ? await db.collection("uploads").findOne({ id: identity.upload_id, ownerUserId: identity.user_id, purpose: "provider-document", documentType: "identity", visibility: "private", mimeType: { $in: ["image/webp", "image/png", "image/jpeg"] } }, { session }) : null;
  if (!identity || !upload || documents.some(d => d.status !== "approved")) throw new HttpError(409, "Approve the current identity document photo, its masking/name checks and all submitted documents before approving this provider.");
}
/** Existing profiles without the current photo policy return to review, preserving bookings. */
export async function reviewLegacyProviderIdentity() {
  const db=await getMongoDb();let returnedToReview=0;
  const cursor=db.collection<Document & {_id:string}>("marketplace_providers").find({active:1},{projection:{id:1}});
  for await(const candidate of cursor) returnedToReview+=await withMongoTransaction(async session=>{
    const provider=await db.collection("marketplace_providers").findOneAndUpdate({id:candidate.id,active:1},{$inc:{reservation_version:1}},{session});if(!provider)return 0;
    try{await approvedIdentityDocuments(String(candidate.id),session);}catch(error){
      if(!(error instanceof HttpError)||error.status!==409)throw error;
      const now=new Date().toISOString(),id=randomUUID();
      await db.collection("marketplace_providers").updateOne({id:candidate.id},{$set:{active:0,verified:0,verification_status:"pending",verification_reason:"A current government identity photo, consent and administrator review are required."}},{session});
      await db.collection<Document & {_id:string}>("platform_audit").insertOne({_id:id,id,actor_id:"system",action:"provider.identity-policy-review",target_id:candidate.id,details:JSON.stringify({policyVersion:IDENTITY_POLICY_VERSION}),created_at:now},{session});
      return 1;
    }
    return 0;
  });
  return returnedToReview;
}
