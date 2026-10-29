"use client";
import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/** Enables interactive submissions only after their event handlers are attached. */
export function useHydrated() {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
