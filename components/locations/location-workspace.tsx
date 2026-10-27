"use client";
import Link from "next/link";
import {useCallback,useEffect,useRef,useState} from "react";
import {ArrowLeft,LocateFixed,MapPin,Navigation,RefreshCw,ShieldCheck,Square,X} from "lucide-react";
import {sessionFetch} from "@/lib/session-client";
import {directionsUrl,type BookingLocation,type SharedPosition} from "@/lib/location-types";
import {BookingMap} from "./booking-map";
import styles from "./location.module.css";

type GPSPoint={latitude:number;longitude:number;accuracy:number;observedAt:string};
type Sharing={id:string;sequence:number;watch:number;latest:GPSPoint|null;sentAt:string;busy:boolean;timer:ReturnType<typeof setInterval>|null;deadline:ReturnType<typeof setTimeout>|null};
const gpsOptions={enableHighAccuracy:true,maximumAge:0,timeout:15000};
function when(value:string){return new Date(value).toLocaleString("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"medium"})+" IST";}
function Participant({title,name,location}:{title:string;name:string;location:SharedPosition}){
  return <section className={styles.participant}><h3>{title} · {name}</h3><span className={`${styles.badge} ${location.state==="recent"?styles.recent:""}`}>{location.state==="recent"?"Recent shared update":location.point?"Last known location":"Location not shared"}</span>
    {location.point?<><p className={styles.note}>GPS observed {when(location.point.observedAt)}<br/>Saved {when(location.point.receivedAt)}<br/>Accuracy reported by device: ±{Math.round(location.point.accuracy)} m</p><p className={styles.note}>{location.point.latitude.toFixed(6)}, {location.point.longitude.toFixed(6)}</p><a className={styles.secondary} href={directionsUrl(location.point)} target="_blank" rel="noopener noreferrer"><Navigation size={16} aria-hidden="true"/>Directions to {title.toLowerCase()}</a></>:<p className={styles.note}>The service address below remains available without GPS permission.</p>}
  </section>;
}
function AddressEditor({data,save,draftPin}:{data:BookingLocation;save:(input:Record<string,unknown>)=>Promise<boolean>;draftPin:{latitude:number;longitude:number}|null}){
  const [address,setAddress]=useState(data.address),[landmark,setLandmark]=useState(data.landmark),[latitude,setLatitude]=useState(data.sitePin?.latitude.toString()||""),[longitude,setLongitude]=useState(data.sitePin?.longitude.toString()||""),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const pin=draftPin||(latitude.trim()&&longitude.trim()?{latitude:Number(latitude),longitude:Number(longitude)}:null);
  return <form onSubmit={async event=>{event.preventDefault();setError("");if((!!latitude.trim()!==!!longitude.trim())&&!draftPin){setError("Enter both latitude and longitude, or leave both empty.");return;}setBusy(true);try{await save({action:"site",address,landmark,pin,version:data.version,consent});}finally{setBusy(false);}}}>
    <h2>Confirm your service address</h2><p className={styles.note}>Use the address where the work will take place. Your live GPS is separate and does not move this service pin automatically.</p>
    <label className={styles.label}>Service address<textarea value={address} onChange={event=>setAddress(event.target.value)} required minLength={10} maxLength={500} rows={3}/></label>
    <label className={styles.label}>Landmark or arrival instructions<input value={landmark} onChange={event=>setLandmark(event.target.value)} maxLength={200}/></label>
    <div className={styles.fields}><label className={styles.label}>Service latitude<input type="number" step="any" min={-90} max={90} value={draftPin?draftPin.latitude:latitude} onChange={event=>setLatitude(event.target.value)} readOnly={!!draftPin}/></label><label className={styles.label}>Service longitude<input type="number" step="any" min={-180} max={180} value={draftPin?draftPin.longitude:longitude} onChange={event=>setLongitude(event.target.value)} readOnly={!!draftPin}/></label></div>
    <p className={styles.note}>{draftPin?"A selected map/GPS pin is ready. Save the address to publish it.":"Coordinates are optional. You can place a pin on the map or enter both coordinates here."}</p>
    <label className={styles.check}><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)} required/><span>I confirm this service address and agree to share its pin and arrival instructions with my assigned professional and administrators for this booking.</span></label>
    {error&&<p role="alert" className={styles.error}>{error}</p>}<button className={styles.primary} disabled={busy} type="submit">{busy?"Saving address…":"Save service address & pin"}</button>
  </form>;
}
export function LocationWorkspace({initial}:{initial:BookingLocation}){
  const [data,setData]=useState<BookingLocation|null>(initial),[error,setError]=useState(""),[notice,setNotice]=useState(""),[refreshing,setRefreshing]=useState(false),[mapLoaded,setMapLoaded]=useState(false),[consent,setConsent]=useState(false),[sharing,setSharing]=useState(false),[busy,setBusy]=useState(false),[draftPin,setDraftPin]=useState<{latitude:number;longitude:number}|null>(null);
  const active=useRef<Sharing|null>(null),mounted=useRef(true),loading=useRef(false),pendingStop=useRef<Record<string,unknown>|null>(null),stopControl=useRef<(reason:string,beacon?:boolean)=>void>(()=>{});
  const endpoint=`/api/bookings/${encodeURIComponent(initial.bookingId)}/location?source=${initial.source}`;
  const load=useCallback(async(visible=false)=>{
    if(loading.current)return;loading.current=true;if(visible)setRefreshing(true);
    try{const response=await sessionFetch(endpoint,{cache:"no-store"});const body=await response.json();if(!response.ok){if(response.status===401||response.status===403||response.status===404){stopControl.current("session_ended");if(mounted.current)setData(null);}throw new Error(body.error||"Location details could not be refreshed.");}
      if(mounted.current){setData(body);if(visible)setError("");if(!body.canShare&&active.current)stopControl.current("session_ended");}
    }catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:"Unable to refresh locations.");}
    finally{loading.current=false;if(mounted.current)setRefreshing(false);}
  },[endpoint]);
  const post=useCallback(async(input:Record<string,unknown>,keepalive=false)=>{
    const response=await sessionFetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input),keepalive});const body=await response.json();if(!response.ok)throw Object.assign(new Error(body.error||"Location update was not saved."),{status:response.status});return body;
  },[endpoint]);
  const clearWatch=useCallback(()=>{
    const session=active.current;if(!session)return null;active.current=null;navigator.geolocation?.clearWatch(session.watch);if(session.timer)clearInterval(session.timer);if(session.deadline)clearTimeout(session.deadline);return session;
  },[]);
  const finish=useCallback((reason:string,beacon=false)=>{
    const session=clearWatch();if(!session)return;
    const finalPosition=session.latest&&session.latest.observedAt>session.sentAt?{sequence:++session.sequence,point:session.latest}:undefined;
    const payload={action:"stop",sessionId:session.id,reason,...(finalPosition?{finalPosition}:{})};
    if(mounted.current){setSharing(false);setNotice("Location sharing stopped. Your last successfully saved point and the service address remain available.");}
    if(beacon&&navigator.sendBeacon){const accepted=navigator.sendBeacon(endpoint,new Blob([JSON.stringify(payload)],{type:"application/json"}));if(accepted)return;}
    pendingStop.current=payload;void post(payload,true).then(()=>{pendingStop.current=null;if(mounted.current)void load();}).catch(()=>{if(mounted.current)setError("Sharing stopped on this device. The last saved location remains available; its timestamp shows when the server last received it.");});
  },[clearWatch,endpoint,load,post]);
  useEffect(()=>{stopControl.current=finish;},[finish]);
  useEffect(()=>{
    mounted.current=true;let debounce:ReturnType<typeof setTimeout>|undefined;
    const refresh=()=>{if(document.visibilityState==="visible"){if(debounce)clearTimeout(debounce);debounce=setTimeout(()=>void load(),500);}};
    const online=()=>{if(pendingStop.current)void post(pendingStop.current,true).then(()=>{pendingStop.current=null;void load();}).catch(()=>{});else refresh();};
    const offline=()=>finish("offline"),close=()=>finish("page_closed",true);
    const timer=setInterval(()=>{if(document.visibilityState==="visible")void load();},20000);
    window.addEventListener("urbankare:service-update",refresh);window.addEventListener("online",online);window.addEventListener("offline",offline);window.addEventListener("pagehide",close);document.addEventListener("visibilitychange",refresh);
    return()=>{mounted.current=false;clearInterval(timer);if(debounce)clearTimeout(debounce);window.removeEventListener("urbankare:service-update",refresh);window.removeEventListener("online",online);window.removeEventListener("offline",offline);window.removeEventListener("pagehide",close);document.removeEventListener("visibilitychange",refresh);finish("page_closed",true);};
  },[finish,load,post]);
  async function save(input:Record<string,unknown>){setError("");setNotice("");try{await post(input);setDraftPin(null);setNotice("Service location saved. Your assigned professional and administrators can see it.");await load();return true;}catch(reason){setError(reason instanceof Error?reason.message:"Location was not saved.");return false;}}
  function geoError(reason:GeolocationPositionError){
    if(reason.code===1){finish("permission_denied");setError("Location permission is blocked. Enable it in this site's browser settings or use a manual service pin.");}
    else setError(reason.code===2?"GPS is unavailable. Your last saved location and address are retained.":"GPS timed out. Keep this page open; the device will retry. Your last saved location is retained.");
  }
  async function start(){
    if(!window.isSecureContext||!navigator.geolocation){setError("GPS sharing needs HTTPS or localhost and a browser with location support. Your address and manual map pin still work.");return;}
    if(!consent){setError("Confirm the sharing notice first.");return;}if(active.current)return;setBusy(true);setError("");
    const session:Sharing={id:crypto.randomUUID(),sequence:0,watch:-1,latest:null,sentAt:"",busy:false,timer:null,deadline:null};
    try{
      await post({action:"start",sessionId:session.id,consent:true});if(!mounted.current)return;active.current=session;setSharing(true);setNotice("Waiting for your device's location permission and a fresh GPS fix…");
      const flush=async()=>{
        if(active.current!==session||session.busy||!session.latest||session.latest.observedAt<=session.sentAt)return;
        const point=session.latest;session.busy=true;
        try{await post({action:"position",sessionId:session.id,sequence:++session.sequence,point});session.sentAt=point.observedAt;if(mounted.current&&active.current===session){setNotice(`Location saved at ${when(new Date().toISOString())}. Sharing continues while this page is available.`);setError("");void load();}}
        catch(reason){if(active.current!==session)return;if(mounted.current)setError(reason instanceof Error?reason.message:"Unable to save GPS. The previous saved location is retained.");if(reason&&typeof reason==="object"&&"status"in reason&&[401,403,404,409].includes(Number(reason.status)))finish("session_ended");}
        finally{session.busy=false;}
      };
      let lastSent=0;
      const capture=(position:GeolocationPosition)=>{if(active.current!==session)return;session.latest={latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy,observedAt:new Date(position.timestamp).toISOString()};if(Date.now()-lastSent>=15000){lastSent=Date.now();void flush();}};
      session.watch=navigator.geolocation.watchPosition(capture,geoError,gpsOptions);
      session.timer=setInterval(()=>{if(active.current===session)navigator.geolocation.getCurrentPosition(capture,geoError,gpsOptions);},20000);
      session.deadline=setTimeout(()=>finish("session_ended"),4*60*60*1000);
    }catch(reason){setError(reason instanceof Error?reason.message:"Could not start sharing.");}finally{if(mounted.current)setBusy(false);}
  }
  function useCurrentPin(){
    if(!window.isSecureContext||!navigator.geolocation){setError("Use HTTPS/localhost for GPS, or enter coordinates manually.");return;}setBusy(true);setError("");
    navigator.geolocation.getCurrentPosition(position=>{if(mounted.current){setDraftPin({latitude:Number(position.coords.latitude.toFixed(6)),longitude:Number(position.coords.longitude.toFixed(6))});setNotice("Current GPS selected as a draft service pin. Check the address and save to share it.");setBusy(false);}},reason=>{if(mounted.current){geoError(reason);setBusy(false);}},gpsOptions);
  }
  return <div className={styles.workspace}>
    <header className={styles.header}><Link className={styles.secondary} href={initial.viewer==="provider"?"/provider/queue":initial.viewer==="admin"?"/admin/tokens":"/dashboard/tracking"}><ArrowLeft size={16} aria-hidden="true"/>Back to service tracking</Link><h1>Meet at the right place.</h1><p>Service address, arrival instructions and the latest shared locations for this booking.</p>{initial.token&&<p>{initial.token}</p>}</header>
    {error&&<p role="alert" className={styles.error}>{error}</p>}{notice&&<p role="status" className={styles.success}>{notice}</p>}
    <div className={styles.row}><button type="button" className={styles.secondary} disabled={refreshing} onClick={()=>void load(true)}><RefreshCw size={16} aria-hidden="true"/>{refreshing?"Refreshing…":"Refresh locations"}</button></div>
    {!data?<div className={styles.card}><h2>Location details are unavailable</h2><p>Sign in with the booking account or contact support if the assignment changed. Use Refresh locations to retry.</p></div>:<div className={styles.grid}>
      <div className={styles.column}>
        <section className={styles.card}><h2><MapPin size={20} className="mr-2 inline" aria-hidden="true"/>Service destination</h2><p className={styles.address}>{data.address||"The customer has not added an address yet."}</p>{data.landmark&&<p className={styles.note}>Arrival instructions: {data.landmark}</p>}{data.sitePin&&<p className={styles.note}>Saved service pin: {data.sitePin.latitude.toFixed(6)}, {data.sitePin.longitude.toFixed(6)}</p>}<div className={styles.row}>{(data.sitePin||data.address)&&<a className={styles.primary} href={directionsUrl(data.sitePin||data.address)} target="_blank" rel="noopener noreferrer"><Navigation size={16} aria-hidden="true"/>Navigate to service address</a>}</div><p className={styles.note}>Directions open Google Maps and share your chosen destination with Google. Check the written address before travelling.</p></section>
        <section className={styles.card}><h2>Booking map</h2>{mapLoaded?<BookingMap data={draftPin?{...data,sitePin:draftPin}:data} onPin={data.canEditAddress?(latitude,longitude)=>setDraftPin({latitude,longitude}):undefined}/>:<><p className={styles.note}>Load an OpenStreetMap map to see shared pins. This sends the visible map area and your IP address to the map provider. GPS sharing does not require loading map tiles.</p><button type="button" className={styles.secondary} onClick={()=>setMapLoaded(true)}>Load interactive map</button></>}{data.canEditAddress&&<div className={styles.row}><button className={styles.secondary} type="button" disabled={busy} onClick={useCurrentPin}><LocateFixed size={16} aria-hidden="true"/>Use my current location for service pin</button>{draftPin&&<button type="button" className={styles.secondary} onClick={()=>setDraftPin(null)}><X size={16} aria-hidden="true"/>Discard draft pin</button>}</div>}</section>
        {data.canEditAddress&&<section className={styles.card}><AddressEditor key={data.version} data={data} save={save} draftPin={draftPin}/></section>}
      </div>
      <div className={styles.column}><section className={styles.card}><h2>Shared locations</h2><p className={styles.note}>A recent update means a point was received within 90 seconds. Always check its GPS timestamp. Last known points remain when GPS, the page or the connection stops.</p><Participant title="Customer" name={data.customer.name} location={data.customer.location}/>{data.provider?<Participant title="Professional" name={data.provider.name} location={data.provider.location}/>:<p className={styles.note}>A professional has not been assigned yet. Only you and administrators can currently access this location page.</p>}</section>
        <section className={styles.card}><h2><ShieldCheck size={20} className="mr-2 inline" aria-hidden="true"/>{data.viewer==="admin"?"Authorized administration view":"Your sharing controls"}</h2>
          <p className={styles.note}>Only the booking customer, currently assigned professional and administrators can access these details. GPS points remain accessible in the app for up to {data.retentionDays} days after the last update; no journey history is recorded. Explicit sharing expires after four hours and can be stopped earlier. Saved addresses and encrypted backups follow their separate retention policies. See the <Link href="/privacy" className="underline">privacy notice</Link>.</p>
          {data.viewer!=="admin"&&<><label className={styles.check}><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)} disabled={sharing}/><span>I agree to share my device’s location with the other participant and administrators for this booking. The last saved point remains visible when sharing stops, until I remove it or it expires.</span></label><div className={styles.row}>{sharing?<button type="button" className={styles.primary} onClick={()=>finish("stopped")}><Square size={15} aria-hidden="true"/>Stop sharing my location</button>:<button type="button" className={styles.primary} disabled={busy||!data.canShare||!consent} onClick={()=>void start()}><LocateFixed size={16} aria-hidden="true"/>Share my live location</button>}<button type="button" className={styles.danger} disabled={busy} onClick={async()=>{if(!window.confirm("Remove your saved GPS point for this booking? Your service address will remain."))return;clearWatch();setSharing(false);setBusy(true);try{await post({action:"forget"});setNotice("Your saved GPS point was removed. The service address is retained.");await load();}catch(reason){setError(reason instanceof Error?reason.message:"The point could not be removed.");}finally{setBusy(false);}}}>Remove my saved GPS point</button></div>{!data.canShare&&<p className={styles.note}>Live sharing is available for confirmed or ongoing services. Address editing closes when work starts.</p>}</>}
          <p className={styles.note}>Keep this page open for updates. Browsers cannot keep GPS running after the app/browser is closed and may pause it when the screen is locked. Closing sends a best-effort final update; if it cannot reach the server, the previously saved point stays available. No background location tracking is claimed.</p>
        </section></div>
    </div>}
  </div>;
}
