import { request } from "./client.js";

export interface RegisterMerchantInput {
  businessProfile: {
    legalName: string;
    registrationNumber: string;
    businessType: "sole_proprietorship" | "llc" | "partnership" | "public_company" | "other";
    contactEmail: string;
    contactPhone: string;
    addressLine1: string;
    city: string;
  };
  owner: { email: string; password: string };
}

export interface RegisterMerchantResponse {
  merchantId: string;
  ownerUserId: string;
  onboardingStatus: string;
}

/** Public sign-up: creates the merchant and its owner. It does not log anyone in; the owner signs in afterwards. */
export function registerMerchant(input: RegisterMerchantInput): Promise<RegisterMerchantResponse> {
  return request("/v1/merchants", { method: "POST", body: JSON.stringify(input) });
}
