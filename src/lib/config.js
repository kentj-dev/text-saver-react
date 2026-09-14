// These values are public and are bundled into the extension. Creem API keys
// and webhook secrets belong only in the Laravel backend.
export const BILLING_CONFIG = Object.freeze({
  apiBaseUrl: 'https://apps.asterulabs.com/api/v1',
  productSlug: 'text-saver',
  plusCheckoutUrl: 'https://www.creem.io/test/payment/prod_3qpZzQmcGSNPpzaLkgJaZQ',
});

export function isLicensingConfigured() {
  return /^https:\/\//.test(BILLING_CONFIG.apiBaseUrl) && Boolean(BILLING_CONFIG.productSlug);
}

export function isCheckoutConfigured() {
  return /^https:\/\//.test(BILLING_CONFIG.plusCheckoutUrl);
}

export function isBillingConfigured() {
  return isLicensingConfigured() && isCheckoutConfigured();
}
