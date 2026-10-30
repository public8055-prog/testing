import { ImageResponse } from "next/og";
export const alt = "SanjuNow — local services and workforce management";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default function OpenGraphImage() {
  return new ImageResponse(<div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 76px", background: "#eef4ed", color: "#16333d", fontFamily: "sans-serif" }}><div style={{ display: "flex", fontSize: 38, fontWeight: 700 }}>SanjuNow<span style={{ color: "#18847b" }}>.</span></div><div style={{ display: "flex", flexDirection: "column", gap: 18 }}><div style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.08, display: "flex", flexDirection: "column" }}><div style={{ display: "flex" }}>A little help.</div><div style={{ display: "flex" }}>A clearer workday.</div></div><div style={{ fontSize: 28, color: "#3c6268", display: "flex" }}>Local services · Bookings · Workforce management</div></div><div style={{ display: "flex", fontSize: 20, letterSpacing: 4, color: "#217a70" }}>BOOK · MANAGE · TRACK</div></div>, size);
}
