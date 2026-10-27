export function businessDetails() {
  const email = process.env.BUSINESS_SUPPORT_EMAIL?.trim() || "";
  const phone = (process.env.PUBLIC_WHATSAPP_NUMBER ?? "919717621336").replace(/\D/g, "");
  const deployment=process.env.VERCEL_PROJECT_PRODUCTION_URL||process.env.VERCEL_URL;
  const domain = process.env.APP_URL || (process.env.VERCEL==="1"&&deployment?`https://${deployment}`:"http://localhost:3000");
  let publicOrigin: string | null = null;
  try { const url = new URL(domain); if (url.protocol === "https:" && !/^(localhost|127\.|\[::1\])/.test(url.hostname)) publicOrigin = url.origin; } catch { /* No public deployment configured. */ }
  return {
    legalName: process.env.BUSINESS_LEGAL_NAME?.trim() || "",
    address: process.env.BUSINESS_ADDRESS?.trim() || "",
    supportEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
    grievanceName: process.env.GRIEVANCE_OFFICER_NAME?.trim() || "",
    grievanceEmail: process.env.GRIEVANCE_EMAIL?.trim() || "",
    whatsapp: /^[1-9]\d{9,14}$/.test(phone) ? `https://wa.me/${phone}?text=${encodeURIComponent("Hello UrbanKare, I need help with a service.")}` : "",
    publicOrigin,
    launchReady: process.env.PUBLIC_LAUNCH_READY === "true" && Boolean(publicOrigin && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && process.env.BUSINESS_LEGAL_NAME?.trim() && process.env.BUSINESS_ADDRESS?.trim() && process.env.GRIEVANCE_OFFICER_NAME?.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.GRIEVANCE_EMAIL || "")),
  };
}
