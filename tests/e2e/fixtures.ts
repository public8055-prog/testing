import { test as base, type Browser } from "@playwright/test";
import { randomInt } from "node:crypto";

export { expect } from "@playwright/test";
export type { Page, TestInfo, BrowserContext, Locator } from "@playwright/test";
let client = randomInt(1, 60000);
const isolated = process.env.E2E_ISOLATED_CLIENT_IPS === "1";
if (isolated && !process.env.MONGODB_DB?.startsWith("urbankare_test_e2e_")) throw new Error("Isolated browser acceptance requires a dedicated urbankare_test_e2e_ database in both server and test environments.");
function clientHeaders(baseURL = process.env.E2E_BASE_URL || "http://localhost:3000"): Record<string, string> {
  if (!isolated) return {};
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname)) throw new Error("Isolated client IP fixtures are restricted to a loopback test gateway.");
  const number = ++client % 65000;
  return { "X-Forwarded-For": `198.18.${Math.floor(number / 254)}.${number % 254 + 1}` };
}

// The loopback QA gateway explicitly trusts these fixture headers. Production keeps
// TRUST_PROXY=false unless its edge overwrites them. Real Redis limits stay enabled.
export const test = base.extend({
  extraHTTPHeaders: async ({ baseURL }, provide) => { await provide(clientHeaders(baseURL)); },
  browser: [async ({ browser }, use) => {
    const wrapped = new Proxy(browser, {
      get(target, key) {
        if (key === "newContext") return (options: Parameters<Browser["newContext"]>[0] = {}) => target.newContext({ ...options, extraHTTPHeaders: { ...clientHeaders(options.baseURL), ...options.extraHTTPHeaders } });
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await use(wrapped);
  }, { scope: "worker" }],
});
