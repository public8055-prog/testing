"use client";
/* eslint-disable @next/next/no-img-element -- Keep native image sizing/loading while recovering external image failures. */

import { useState, type ComponentPropsWithoutRef } from "react";

type ResilientImageProps = ComponentPropsWithoutRef<"img"> & {
  fallbackSrc?: string;
  fallbackAlt?: string;
};

const SERVICE_FALLBACK = "/images/service-fallback.svg";

function responsiveSource(src: ResilientImageProps["src"]) {
  if (typeof src !== "string" || !src) return undefined;
  try {
    const url = new URL(src);
    if (url.protocol !== "https:" || url.hostname !== "images.unsplash.com") return undefined;
    const maximum = Math.min(1600, Math.max(64, Number(url.searchParams.get("w")) || 1280));
    const widths = [...new Set([64, 96, 160, 240, 320, 480, 640, 960, 1280].filter(width => width <= maximum).concat(maximum))];
    url.searchParams.set("auto", "format");
    url.searchParams.set("q", String(Math.min(78, Math.max(30, Number(url.searchParams.get("q")) || 78))));
    return widths.map(width => { url.searchParams.set("w", String(width)); return `${url.href} ${width}w`; }).join(", ");
  } catch { return undefined; }
}

/** Native image sizing and loading, with a local fallback even after an early SSR image failure. */
export function ResilientImage(props: ResilientImageProps) {
  return <ImageSource key={`${props.src || ""}|${props.srcSet || ""}`} {...props} />;
}

function ImageSource({ src, srcSet, sizes, decoding = "async", alt = "", fallbackSrc = SERVICE_FALLBACK, fallbackAlt, onError, ...props }: ResilientImageProps) {
  const [failed, setFailed] = useState(!src && !srcSet);
  return <img
    {...props}
    ref={node => {
      // A remote photo may have failed before React attached its error listener.
      if (!failed && node?.complete && node.currentSrc && node.naturalWidth === 0) setFailed(true);
    }}
    src={failed ? fallbackSrc : src}
    srcSet={failed ? undefined : srcSet || responsiveSource(src)}
    sizes={failed ? undefined : sizes}
    decoding={decoding}
    alt={failed ? fallbackAlt ?? (alt ? "SanjuNow service illustration" : "") : alt}
    data-image-fallback={failed ? "true" : undefined}
    onError={event => {
      if (!failed) setFailed(true);
      onError?.(event);
    }}
  />;
}
