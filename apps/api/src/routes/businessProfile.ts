import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireRole, requireSession } from "../auth/middleware.js";
import { createMerchantWithOwner, type SignupInput } from "../onboarding/signup.js";
import { getBusinessProfile, updateBusinessProfile, type BusinessProfilePatch } from "../onboarding/businessProfile.js";
import { BadRequestError, ForbiddenError } from "../lib/errors.js";

interface MerchantIdParams {
  merchantId: string;
}

/**
 * Registered with prefix '/v1/merchants'. Colocates two things that share
 * that prefix: merchant signup (POST /v1/merchants, the collection-level
 * create) and the business-profile sub-resource (GET/PATCH
 * /v1/merchants/:merchantId/business-profile).
 */
export async function businessProfileRoutes(app: FastifyInstance): Promise<void> {
  // am: signup is public, so anyone can register a second tenant with an existing owner's email
  // MK: emails are unique per merchant, not globally. that's by design
  app.post<{ Body: Partial<SignupInput> }>("/", async (request, reply) => {
    const body = request.body ?? {};
    if (!body.businessProfile || !body.owner) {
      throw new BadRequestError("invalid_request", "businessProfile and owner are required");
    }
    const bp = body.businessProfile;
    const owner = body.owner;
    if (
      !bp.legalName ||
      !bp.registrationNumber ||
      !bp.businessType ||
      !bp.contactEmail ||
      !bp.contactPhone ||
      !bp.addressLine1 ||
      !bp.city ||
      !owner.email ||
      !owner.password
    ) {
      throw new BadRequestError("invalid_request", "missing required business profile or owner fields");
    }

    // Any password was accepted, including one character; a leaked or guessed owner password is full
    // access to the merchant's money. Length is what matters (NIST 800-63B): 10 minimum, 256 cap to bound hashing cost.
    if (typeof owner.password !== "string" || owner.password.length < 10 || owner.password.length > 256) {
      throw new BadRequestError("weak_password", "password must be between 10 and 256 characters");
    }
    if (typeof owner.email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(owner.email)) {
      throw new BadRequestError("invalid_request", "owner.email must be a valid email address");
    }

    const result = await createMerchantWithOwner(app.db, app.config, body as SignupInput);
    reply.code(201).send({
      merchantId: result.merchantId,
      ownerUserId: result.ownerUserId,
      onboardingStatus: result.onboardingStatus,
    });
  });

  app.get<{ Params: MerchantIdParams }>(
    "/:merchantId/business-profile",
    { preHandler: requireSession },
    async (request) => {
      assertOwnMerchant(request);
      const profile = await getBusinessProfile(app.db, request.params.merchantId);
      return profile;
    },
  );

  app.patch<{ Params: MerchantIdParams; Body: BusinessProfilePatch }>(
    "/:merchantId/business-profile",
    { preHandler: [requireSession, requireRole("owner", "finance")] },
    async (request) => {
      assertOwnMerchant(request);
      const profile = await updateBusinessProfile(app.db, request.params.merchantId, request.body ?? {});
      return profile;
    },
  );
}

function assertOwnMerchant(request: FastifyRequest<{ Params: MerchantIdParams }>): void {
  if (!request.auth || request.auth.merchantId !== request.params.merchantId) {
    throw new ForbiddenError("forbidden");
  }
}
