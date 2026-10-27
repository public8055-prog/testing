/** Public catalogue browsing does not require a database or a local container.
 * @param {Record<string,string|undefined>} [environment] */
export function isBuiltinCatalog(environment = process.env) {
  const source = environment.CATALOG_SOURCE || "auto";
  if (!["auto", "builtin", "database"].includes(source)) throw new Error("CATALOG_SOURCE must be auto, builtin or database.");
  if (source !== "auto") return source === "builtin";
  const mongo = environment.MONGODB_URI || "", redis = environment.REDIS_URL || "";
  if (!mongo || !redis) return true;
  // Loopback inside a serverless function is not this developer's computer.
  const loopback=uri=>{const authority=uri.match(/^[a-z+]+:\/\/([^/?#]*)/i)?.[1].split("@").at(-1)||"";return authority.split(",").some(host=>/^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i.test(host));};
  if (environment.VERCEL === "1" && (loopback(mongo)||loopback(redis))) return true;
  return false;
}
export function isBuiltinPublicRead(path, method) {
  return ["GET", "HEAD"].includes(method) && ( ["/api/services", "/api/categories", "/api/health", "/api/auth/me"].includes(path) || /^\/api\/services\/[a-z0-9-]{1,120}$/.test(path));
}
export function catalogCacheControl(){return isBuiltinCatalog()?"public, max-age=0, s-maxage=300, stale-while-revalidate=600":"no-store";}
