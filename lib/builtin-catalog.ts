import {categories, services} from "./data";
import type {Category, Service} from "./types";
const recurringCategories:Category[]=[
  {slug:"housekeeping",name:"Housekeeping",tagline:"Recurring help with everyday home care",icon:"House",image:"/images/service-fallback.svg",color:"from-teal-500 to-cyan-500",servicesCount:0},
  {slug:"drivers",name:"Drivers",tagline:"Professional driving arrangements",icon:"CarFront",image:"/images/service-fallback.svg",color:"from-blue-500 to-cyan-500",servicesCount:0},
  {slug:"home-tutors",name:"Home tutors",tagline:"Personal learning and study support",icon:"BookOpen",image:"/images/service-fallback.svg",color:"from-violet-500 to-indigo-500",servicesCount:0},
  {slug:"household-support",name:"Household support",tagline:"Practical support for your daily routine",icon:"HeartHandshake",image:"/images/service-fallback.svg",color:"from-rose-500 to-pink-500",servicesCount:0},
];
export function builtinServices(category?:string):Service[]{
  return services.filter(service=>!category||service.category===category).map(service=>structuredClone({...service,mrp:service.price,rating:0,reviews:0,badge:undefined}));
}
export function builtinCategories():Category[]{
  return [...categories,...recurringCategories].map(category=>({...category,servicesCount:services.filter(service=>service.category===category.slug).length}));
}
export function builtinService(slug:string):Service|null{return builtinServices().find(service=>service.slug===slug)||null;}
