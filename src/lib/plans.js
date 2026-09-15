export const DEFAULT_PLAN_ID = "free";

export const PLAN_LIMITS = Object.freeze({
  free: Object.freeze({
    id: "free",
    name: "Free",
    price: 0,
    maxTabs: 10,
    maxCharactersPerTab: 10000,
    maxLinesPerTab: 5000,
    maxStateBytes: 512 * 1024,
    maxSyncedTabs: 0,
    maxDevices: 0,
    cloudSync: false,
  }),
  plus: Object.freeze({
    id: "plus",
    name: "Plus",
    price: 2.99,
    maxTabs: 20,
    maxCharactersPerTab: 20000,
    maxLinesPerTab: 10000,
    maxStateBytes: 5 * 1024 * 1024,
    maxCloudBytes: 5 * 1024 * 1024,
    maxSyncedTabs: 5,
    maxDevices: 2,
    cloudSync: true,
  }),
});

export function getPlanLimits(planId = DEFAULT_PLAN_ID) {
  return PLAN_LIMITS[planId] || PLAN_LIMITS[DEFAULT_PLAN_ID];
}

export function isPaidPlan(planId) {
  return planId === "plus";
}

export function serializedStateBytes(state) {
  return new TextEncoder().encode(JSON.stringify(state)).byteLength;
}
