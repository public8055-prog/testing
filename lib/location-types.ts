export type LocationPoint = { latitude:number; longitude:number; accuracy:number; observedAt:string; receivedAt:string };
export type SharedPosition = { point:LocationPoint|null; state:"recent"|"last_known"|"not_shared"; sharingUntil:string|null; stoppedReason:string|null };
export type BookingLocation = {
  source:"catalog"|"provider"; bookingId:string; status:string; token:string|null;
  viewer:"customer"|"provider"|"admin"; address:string; landmark:string;
  sitePin:{latitude:number;longitude:number}|null; version:number;
  customer:{name:string;location:SharedPosition}; provider:{name:string;location:SharedPosition}|null;
  canEditAddress:boolean; canShare:boolean; retentionDays:number; serverTime:string;
};
export function directionsUrl(destination:string|{latitude:number;longitude:number}){
  const query=new URLSearchParams({api:"1",destination:typeof destination==="string"?destination:`${destination.latitude},${destination.longitude}`,travelmode:"driving"});
  return `https://www.google.com/maps/dir/?${query}`;
}
export function locationPageUrl(source:string,id:string){return `/locations/${source}/${encodeURIComponent(id)}`;}
