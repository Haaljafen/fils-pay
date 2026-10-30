import { useState } from "react";
import { formatBhd, parseBhdToFils, toFils } from "@filspay/money";
import { request, describeError } from "../../api/client.js";
import { useDashboardAuth } from "../../auth/DashboardAuthContext.js";
import { RequireRole } from "../../auth/RequireRole.js";
import { InlineConfirm } from "../../components/InlineConfirm.js";
import { bhd } from "../../format.js";
import type { TransactionDto } from "../../types.js";

interface RefundResponse {
  id: string;
  amountFils: number;
  feeReversedFils: number;
  transactionStatus: string;
  refundedTotalFils: number;
}

interface RefundDrawerProps {
  txn: TransactionDto;
  onRefunded: () => Promise<void>;
}

const REFUNDABLE_STATUSES = new Set(["captured", "partially_captured", "partially_refunded"]);

/**
 * Full or partial refund of a captured transaction
 * (`POST /v1/merchants/:merchantId/refunds`). Owner/finance only, matching
 * the API's own role check. The amount is entered in BD and parsed exactly
 * (three decimals, 1 BD = 1000 fils); left blank, the API refunds everything
 * still refundable.
 */
export function RefundDrawer({ txn, onRefunded }: RefundDrawerProps) {
  const { me } = useDashboardAuth();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The refund waiting for the user's yes/no; undefined amount means "everything refundable".
  const [pending, setPending] = useState<{ amountFils?: number; text: string } | null>(null);

  const merchantId = me?.merchant.id;
  const remainingFils = txn.capturedFils - txn.refundedFils;
  if (!REFUNDABLE_STATUSES.has(txn.status) || remainingFils <= 0) return null;

  function handleRefund(event: React.FormEvent): void {
    event.preventDefault();
    if (!merchantId) return;

    const trimmed = amount.trim();
    let amountFils: number | undefined;
    if (trimmed !== "") {
      try {
        amountFils = parseBhdToFils(trimmed);
      } catch {
        setError("Enter an amount in BD with up to three decimals, e.g. 4.750");
        return;
      }
      if (amountFils <= 0 || amountFils > remainingFils) {
        setError(`Enter an amount between 0.001 and ${bhd(remainingFils)}`);
        return;
      }
    }
    setError(null);
    setPending({ amountFils, text: bhd(amountFils ?? remainingFils) });
  }

  async function submitRefund(amountFils: number | undefined): Promise<void> {
    if (!merchantId) return;
    setSubmitting(true);
    setError(null);
    try {
      await request<RefundResponse>(`/v1/merchants/${encodeURIComponent(merchantId)}/refunds`, {
        method: "POST",
        // A fresh key per submission; the API's row lock and validation stop a
        // double click from refunding twice.
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(amountFils === undefined ? { transactionId: txn.id } : { transactionId: txn.id, amountFils }),
      });
      setOpen(false);
      setAmount("");
      setPending(null);
      // Refetch: the refund changed the status, totals and timeline.
      await onRefunded();
    } catch (err) {
      setPending(null);
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <RequireRole allow={["owner", "finance"]}>
      <div className="dash-actions">
        {error ? <p className="dash-error">{error}</p> : null}
        {open ? (
          <form className="dash-form dash-form-inline" onSubmit={(e) => void handleRefund(e)}>
            <label>
              Refund amount in BD (blank refunds {bhd(remainingFils)})
              <input
                type="text"
                inputMode="decimal"
                placeholder={formatBhd(toFils(remainingFils))}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <p className="dash-muted">
              Captured {bhd(txn.capturedFils)} · already refunded {bhd(txn.refundedFils)} · refundable{" "}
              {bhd(remainingFils)}
            </p>
            <button type="submit" className="dash-button" disabled={submitting}>
              {submitting ? "Refunding..." : "Refund"}
            </button>
            <button type="button" className="dash-button" disabled={submitting} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" className="dash-button" onClick={() => setOpen(true)}>
            Refund
          </button>
        )}
        {pending ? (
          <InlineConfirm
            message={`Refund ${pending.text} to the cardholder? This cannot be recalled.`}
            confirmLabel="Refund"
            busy={submitting}
            onConfirm={() => void submitRefund(pending.amountFils)}
            onCancel={() => setPending(null)}
          />
        ) : null}
      </div>
    </RequireRole>
  );
}
