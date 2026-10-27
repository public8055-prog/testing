"use client";
import {useEffect,useRef,useState} from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import type {BookingLocation} from "@/lib/location-types";
import styles from "./location.module.css";

export function BookingMap({data,onPin}:{data:BookingLocation;onPin?:(latitude:number,longitude:number)=>void}){
  const element=useRef<HTMLDivElement>(null),instance=useRef<Leaflet.Map|null>(null),layers=useRef<Leaflet.LayerGroup|null>(null),library=useRef<typeof Leaflet|null>(null),pinHandler=useRef(onPin),initialFit=useRef(false);
  const [loaded,setLoaded]=useState(false),[error,setError]=useState("");
  useEffect(()=>{pinHandler.current=onPin;},[onPin]);
  useEffect(()=>{
    let disposed=false,observer:ResizeObserver|undefined;
    void import("leaflet").then(L=>{
      if(disposed||!element.current)return;library.current=L;
      const map=L.map(element.current,{scrollWheelZoom:false,keyboard:true}).setView([20.5937,78.9629],4);instance.current=map;
      const configured=process.env.NEXT_PUBLIC_MAP_TILE_URL||"https://tile.openstreetmap.org/{z}/{x}/{y}.png";
      if(!configured.startsWith("https://")||!["{z}","{x}","{y}"].every(part=>configured.includes(part)))throw new Error("The map tile URL is not configured correctly.");
      const tiles=L.tileLayer(configured,{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'}).addTo(map);
      tiles.on("tileerror",()=>{if(!disposed)setError("Map tiles could not load. The address, coordinates and directions links are still available.");});
      layers.current=L.layerGroup().addTo(map);map.on("click",event=>pinHandler.current?.(Number(event.latlng.lat.toFixed(6)),Number((((event.latlng.lng+180)%360+360)%360-180).toFixed(6))));
      observer=new ResizeObserver(()=>map.invalidateSize());observer.observe(element.current);setLoaded(true);
    }).catch(reason=>{if(!disposed)setError(reason instanceof Error?reason.message:"The map could not load.");});
    return()=>{disposed=true;observer?.disconnect();instance.current?.remove();instance.current=null;layers.current=null;library.current=null;};
  },[]);
  useEffect(()=>{
    const L=library.current,map=instance.current,group=layers.current;if(!loaded||!L||!map||!group)return;
    group.clearLayers();const points:Leaflet.LatLngTuple[]=[];
    const add=(point:{latitude:number;longitude:number;accuracy?:number},name:string,color:string)=>{
      const at:Leaflet.LatLngTuple=[point.latitude,point.longitude];points.push(at);
      const label=document.createElement("span");label.textContent=name;
      L.circleMarker(at,{radius:10,color:"#fff",weight:3,fillColor:color,fillOpacity:1}).bindTooltip(label,{permanent:true,direction:"top",offset:[0,-10]}).addTo(group);
      if(point.accuracy&&point.accuracy<=5000)L.circle(at,{radius:point.accuracy,color,weight:1,fillOpacity:0.08}).addTo(group);
    };
    if(data.sitePin)add(data.sitePin,"Service address","#7551b6");
    if(data.customer.location.point)add(data.customer.location.point,"Customer","#18786b");
    if(data.provider?.location.point)add(data.provider.location.point,"Professional","#285b9b");
    if(points.length&&!initialFit.current){map.fitBounds(L.latLngBounds(points).pad(0.3),{maxZoom:16});initialFit.current=true;}
  },[data,loaded]);
  function center(){const L=library.current,map=instance.current;if(!L||!map)return;const points=[data.sitePin,data.customer.location.point,data.provider?.location.point].filter((point):point is NonNullable<typeof point>=>!!point);if(points.length)map.fitBounds(L.latLngBounds(points.map(point=>[point.latitude,point.longitude] as Leaflet.LatLngTuple)).pad(0.3),{maxZoom:16});}
  return <div className={styles.mapFrame}><div ref={element} className={styles.map} role="region" aria-label="Booking map. Use arrow keys to pan and plus or minus to zoom."/>{!loaded&&!error&&<div className={styles.mapLoading} role="status">Loading map…</div>}<button type="button" className={styles.secondary} onClick={center} disabled={!loaded}>Center shared locations</button>{onPin&&<p className={styles.note}>Tap the map to place the service pin, or enter coordinates in the form. Save the address to publish your pin.</p>}{error&&<p role="alert" className={styles.error}>{error}</p>}</div>;
}
