"use client";

import type { CSSProperties, ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";

export function Reveal({ children, className, delay = 0, style }: { children: ReactNode; className?: string; delay?: number; style?: CSSProperties }) {
  const reduced = useReducedMotion();
  return <motion.div
    className={className}
    style={style}
    initial={false}
    whileInView={reduced !== false ? undefined : { opacity: [0.75, 1], y: [14, 0] }}
    viewport={{ once: true, amount: 0.12 }}
    transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
  >{children}</motion.div>;
}
