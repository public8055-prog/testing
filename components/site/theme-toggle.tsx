"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => { let choice: string | null = null; try { choice = localStorage.getItem("urbankare-theme"); } catch {} const next = choice === "dark" || choice !== "light" && media.matches ? "dark" : "light"; document.documentElement.dataset.theme = next; setTheme(next); };
    apply(); media.addEventListener("change", apply); window.addEventListener("storage", apply);
    return () => { media.removeEventListener("change", apply); window.removeEventListener("storage", apply); };
  }, []);
  const toggle = () => { const next = theme === "light" ? "dark" : "light"; setTheme(next); document.documentElement.dataset.theme = next; try { localStorage.setItem("urbankare-theme", next); } catch {} };
  return <button type="button" onClick={toggle} className="theme-toggle" aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`} aria-pressed={theme === "dark"}>{theme === "dark" ? <Sun size={20} strokeWidth={1.75}/> : <Moon size={20} strokeWidth={1.75}/>}</button>;
}
