import type { CSSProperties } from "react";
import { Sparkles, Scissors, Droplets, Zap, Refrigerator, PaintRoller, Hammer, Wrench } from "lucide-react";

export const serviceThemes = {
  "home-cleaning": { accent: "#386451", soft: "#edf3ed", kicker: "A clean slate for your space", title: "Fresh feels good.", subtitle: "From everyday corners to a whole-home reset. Make space for a cleaner, calmer day.", scope: "The details we take care of", process: "A little method. A big refresh.", icon: Sparkles, kind: "cleaning" },
  "salon-women": { accent: "#875264", soft: "#f6edf0", kicker: "Your moment to unwind", title: "Make time for you.", subtitle: "Beauty and self-care, without the journey. Find the treatment that feels right for your day.", scope: "Your treatment, thoughtfully detailed", process: "From consultation to finishing touches", icon: Scissors, kind: "wellness" },
  "salon-men": { accent: "#596355", soft: "#eff1e9", kicker: "A fresh take on your routine", title: "Look sharp. Feel good.", subtitle: "Grooming and relaxation, brought home. Choose a tidy-up, a new look or time to switch off.", scope: "What your session covers", process: "A routine, made personal", icon: Scissors, kind: "wellness" },
  plumbing: { accent: "#386783", soft: "#edf3f7", kicker: "Little leaks. Clear next steps.", title: "Get things flowing.", subtitle: "A dripping tap or a fitting that needs attention? Find a focused service for the job.", scope: "The scope of your visit", process: "Understand. Repair. Check.", icon: Droplets, kind: "repair" },
  electrician: { accent: "#85631b", soft: "#f8f3e6", kicker: "The everyday essentials", title: "Switch on a better day.", subtitle: "From a new fan to a troublesome socket. Book an electrical service with a clear scope.", scope: "Work included in this service", process: "A careful approach to every connection", icon: Zap, kind: "repair" },
  appliance: { accent: "#3f627d", soft: "#edf2f7", kicker: "Care for the things you count on", title: "Back to the everyday.", subtitle: "Cleaning, maintenance and inspection for the appliances that keep your household moving.", scope: "Know what your visit includes", process: "From inspection to a working check", icon: Refrigerator, kind: "repair" },
  painting: { accent: "#995f42", soft: "#f6eee7", kicker: "A new feeling, in every room", title: "Your next chapter, in colour.", subtitle: "Fresh walls, thoughtful finishes and room for a new point of view. Find a painting service for your space.", scope: "Your project scope", process: "Prepare. Paint. Finish.", icon: PaintRoller, kind: "project" },
  carpentry: { accent: "#806047", soft: "#f3eee7", kicker: "The finishing touches of home", title: "Make your space work.", subtitle: "Assembly, fittings and repairs that help your furniture feel at home.", scope: "What we’ll work on", process: "From the first check to the last fitting", icon: Hammer, kind: "project" },
};

const fallback = { accent: "#6d4c96", soft: "#f2edf8", kicker: "Home care, thoughtfully arranged", title: "A little help, at home.", subtitle: "Explore the scope, choose your service and make it part of your day.", scope: "What’s included", process: "What to expect", icon: Wrench, kind: "repair" };
export function getServiceTheme(category: string) { return serviceThemes[category as keyof typeof serviceThemes] || fallback; }
export function themeStyle(category: string): CSSProperties {
  const theme = getServiceTheme(category);
  return { "--service-accent": theme.accent, "--service-soft": theme.soft } as CSSProperties;
}
