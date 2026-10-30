import type { Pool } from "pg";
import { insertAdminAuditLog } from "../adminAudit/log.js";
import { withTransaction } from "../db/withTransaction.js";
import { recordKycReviewInTx } from "../onboarding/review.js";

export interface BulkApproveMerchantsKycInput {
  merchantIds: string[];
  adminUserId: string;
  notes?: string;
}

/**
 * @property approvedMerchantIds Only merchants that moved from under_review to approved.
 * Already-approved or rejected ids are skipped and not listed.
 */
export interface BulkApproveMerchantsKycResult {
  approvedCount: number;
  approvedMerchantIds: string[];
}

/**
 * Approves the given merchants and audits it.
 *
 * Only a merchant that is `under_review` can be approved. The UPDATE this
 * replaces had no status filter, so a bulk selection could also approve a
 * REJECTED merchant (and one that had never been submitted), and it wrote
 * merchants directly, bypassing recordKycReviewInTx -- the one function allowed
 * to write kyc_passed -- so no merchant_kyc_reviews trail existed for any of them.
 */
export async function bulkApproveMerchantsKyc(
  pool: Pool,
  input: BulkApproveMerchantsKycInput,
): Promise<BulkApproveMerchantsKycResult> {
  return withTransaction(pool, async (client) => {
    const reviewer = await client.query<{ email: string }>(`SELECT email FROM admin_users WHERE id = $1`, [
      input.adminUserId,
    ]);
    const reviewerIdentifier = reviewer.rows[0]?.email ?? input.adminUserId;

    const pending = await client.query<{ id: string }>(
      `SELECT id FROM merchants
        WHERE id = ANY($1::uuid[]) AND onboarding_status = 'under_review'
        ORDER BY id
        FOR UPDATE`,
      [input.merchantIds],
    );
    const approvedMerchantIds: string[] = [];
    for (const row of pending.rows) {
      await recordKycReviewInTx(client, {
        merchantId: row.id,
        outcome: "approved",
        reviewerIdentifier,
        reviewerAdminUserId: input.adminUserId,
        notes: input.notes,
      });
      approvedMerchantIds.push(row.id);
    }

    await insertAdminAuditLog(client, {
      adminUserId: input.adminUserId,
      action: "kyc_bulk_approve",
      targetType: "platform",
      targetId: null,
      metadata: {
        requestedMerchantIds: input.merchantIds,
        approvedMerchantIds,
        notes: input.notes ?? null,
      },
    });

    return { approvedCount: approvedMerchantIds.length, approvedMerchantIds };
  });
}
