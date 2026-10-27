import {
  buildMultiVendorPayoutBatch,
  buildPayPalOrderAuthorization,
  buildPayPalSplitCapturePlan,
  deterministicHash,
  formatMicroToDecimal,
  type ClearedWorkStatementInput,
} from "../../../packages/paypal-settlement-provider/src/index.js";

export interface AGGridStatementRow {
  readonly lineKey: string;
  readonly description: string;
  readonly tClass: string;
  readonly reasonCode: string;
  readonly billedFormatted: string;
  readonly clearedPayableFormatted: string;
  readonly excludedVoidFormatted: string;
  readonly disputedHoldFormatted: string;
  readonly payPalSettlementAction: "CAPTURE" | "VOID_HOLD" | "DISPUTE_HOLD";
}

export interface BryntumTimelineMilestone {
  readonly id: string;
  readonly name: string;
  readonly phase: "M0_VERIFY" | "M1_AGREE" | "M2_AUTHORIZE" | "M3_SETTLE";
  readonly startDate: string;
  readonly endDate: string;
  readonly status: "COMPLETED" | "ACTIVE";
  readonly verificationHash: string;
}

export interface FoxitClearedStatementDocumentPayload {
  readonly documentTitle: string;
  readonly statementId: string;
  readonly statementVersion: number;
  readonly statementHash: string;
  readonly buyerName: string;
  readonly vendorName: string;
  readonly payPalOrderId: string;
  readonly payPalAuthorizationId: string;
  readonly totalBilledUsd: string;
  readonly totalCapturedPayableUsd: string;
  readonly totalVoidedExcludedUsd: string;
  readonly totalHeldDisputedUsd: string;
  readonly watermarkText: string;
  readonly documentIntegrityHash: string;
}

export const DEMO_CLEARED_WORK_STATEMENT: ClearedWorkStatementInput = {
  statementId: "CWS-2026-10-FIN-0042",
  statementVersion: 2,
  statementHash: "sha256:9f4e2a81d07b3c15e6048b9911a2c4d78f90321b5c7d8e9f0123456789abcdef",
  orgId: "org_northwind_enterprise",
  buyerName: "Northwind Global Operations, Inc.",
  vendorName: "Fin AI Customer Support Agent",
  payeeMerchantId: "PAYPAL_MERCHANT_FIN_AI",
  currency: "USD",
  lines: [
    {
      lineKey: "L1_VERIFIED_AUTONOMOUS_RESOLUTIONS",
      description: "Verified autonomous resolutions (4,378 conversations @ $0.99)",
      billedMicro: 4_334_220_000n,
      clearedPayableMicro: 4_334_220_000n,
      excludedCreditMicro: 0n,
      heldInDisputeMicro: 0n,
      evidenceRefs: ["ev:intercom:conv_batch_verified_4378"],
    },
    {
      lineKey: "L2_REOPENED_WITHIN_5_DAY_WINDOW",
      description: "Same-conversation return / reopen within 5-day window (143 conversations)",
      billedMicro: 141_570_000n,
      clearedPayableMicro: 0n,
      excludedCreditMicro: 141_570_000n,
      heldInDisputeMicro: 0n,
      tClass: "T5",
      reasonCode: "same_conversation_return",
      evidenceRefs: ["ev:intercom:reopen_143"],
    },
    {
      lineKey: "L3_HUMAN_AGENT_INTERVENED",
      description: "Human teammate replied before resolution closure (55 conversations)",
      billedMicro: 54_450_000n,
      clearedPayableMicro: 0n,
      excludedCreditMicro: 0n,
      heldInDisputeMicro: 54_450_000n,
      tClass: "T6",
      reasonCode: "human_handoff_occurred",
      evidenceRefs: ["ev:intercom:handoff_55"],
    },
  ],
};

export function runClearinghouseDemoReplay(
  statement: ClearedWorkStatementInput = DEMO_CLEARED_WORK_STATEMENT,
) {
  const orderId = "PAYPAL-ORDER-8841920X";
  const authorizationId = "PAYPAL-AUTH-3391042A";

  const orderAuth = buildPayPalOrderAuthorization(statement);
  const splitPlan = buildPayPalSplitCapturePlan(statement, orderId, authorizationId);
  const payoutBatch = buildMultiVendorPayoutBatch(`BATCH-${statement.statementId}`, [statement]);

  const agGridRows: AGGridStatementRow[] = statement.lines.map((l) => ({
    lineKey: l.lineKey,
    description: l.description,
    tClass: l.tClass ?? "CLEARED",
    reasonCode: l.reasonCode ?? "verified_contract_compliant",
    billedFormatted: `$${formatMicroToDecimal(l.billedMicro)}`,
    clearedPayableFormatted: `$${formatMicroToDecimal(l.clearedPayableMicro)}`,
    excludedVoidFormatted: `$${formatMicroToDecimal(l.excludedCreditMicro)}`,
    disputedHoldFormatted: `$${formatMicroToDecimal(l.heldInDisputeMicro)}`,
    payPalSettlementAction:
      l.clearedPayableMicro > 0n
        ? "CAPTURE"
        : l.excludedCreditMicro > 0n
          ? "VOID_HOLD"
          : "DISPUTE_HOLD",
  }));

  const bryntumTimeline: BryntumTimelineMilestone[] = [
    {
      id: "ms_m2_auth",
      name: "M2: Pre-Execution Authority & PayPal Order v2 AUTHORIZE Hold ($4,530.24)",
      phase: "M2_AUTHORIZE",
      startDate: "2026-10-01T00:00:00Z",
      endDate: "2026-10-01T00:05:00Z",
      status: "COMPLETED",
      verificationHash: orderAuth.payPalRequestId,
    },
    {
      id: "ms_m0_verify",
      name: "M0: Buyer Evidence Adjudication (T5 Reopen & T6 Handoff Exclusions)",
      phase: "M0_VERIFY",
      startDate: "2026-10-31T00:00:00Z",
      endDate: "2026-10-31T01:00:00Z",
      status: "COMPLETED",
      verificationHash: statement.statementHash,
    },
    {
      id: "ms_m1_agree",
      name: "M1: Countersigned Cleared Work Statement & Dispute Evidence Pack",
      phase: "M1_AGREE",
      startDate: "2026-10-31T01:00:00Z",
      endDate: "2026-10-31T02:00:00Z",
      status: "COMPLETED",
      verificationHash: splitPlan.disputeEvidencePack?.packHash ?? statement.statementHash,
    },
    {
      id: "ms_m3_settle",
      name: "M3: PayPal Split CAPTURE ($4,334.22) + Release ($141.57) + Hold ($54.45)",
      phase: "M3_SETTLE",
      startDate: "2026-10-31T02:00:00Z",
      endDate: "2026-10-31T02:05:00Z",
      status: "COMPLETED",
      verificationHash: splitPlan.planHash,
    },
  ];

  const foxitDocumentPayload: FoxitClearedStatementDocumentPayload = {
    documentTitle: `Floe Cleared Work Statement & PayPal Settlement Receipt — ${statement.statementId}`,
    statementId: statement.statementId,
    statementVersion: statement.statementVersion,
    statementHash: statement.statementHash,
    buyerName: statement.buyerName,
    vendorName: statement.vendorName,
    payPalOrderId: orderId,
    payPalAuthorizationId: authorizationId,
    totalBilledUsd: `$${formatMicroToDecimal(splitPlan.totalAuthorizedMicro)}`,
    totalCapturedPayableUsd: `$${formatMicroToDecimal(splitPlan.capturePayableMicro)}`,
    totalVoidedExcludedUsd: `$${formatMicroToDecimal(splitPlan.voidExcludedMicro)}`,
    totalHeldDisputedUsd: `$${formatMicroToDecimal(splitPlan.heldDisputedMicro)}`,
    watermarkText: `CLEARED & VERIFIED · ${statement.statementId} · ${orderId}`,
    documentIntegrityHash: deterministicHash({
      statementId: statement.statementId,
      statementHash: statement.statementHash,
      planHash: splitPlan.planHash,
    }),
  };

  return {
    orderAuth,
    splitPlan,
    payoutBatch,
    agGridRows,
    bryntumTimeline,
    foxitDocumentPayload,
  };
}
