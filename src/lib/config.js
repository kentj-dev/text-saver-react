// Replace these public values before publishing. Secrets belong in Worker bindings,
// never in this extension.
export const BILLING_CONFIG = Object.freeze({
  // Add the Laravel API and new $2.99 Plus checkout URLs during integration.
  apiBaseUrl: '',
  plusCheckoutUrl: '',
});

export function isBillingConfigured() {
  return (
    /^https:\/\//.test(BILLING_CONFIG.apiBaseUrl) &&
    /^https:\/\//.test(BILLING_CONFIG.plusCheckoutUrl)
  );
}
