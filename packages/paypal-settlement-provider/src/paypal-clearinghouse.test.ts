import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DEMO_CLEARED_WORK_STATEMENT,
  runClearinghouseDemoReplay,
} from "../../../apps/clearinghouse-workbench/src/workbench-engine.js";
import {
  handleReportWorkEvidence,
  handleRequestWorkAuthorization,
  handleSettleClearedStatement,
  type AgentAuthorityBudgetPolicy,
} from "../../agent-authority-mcp/src/index.js";
import {
  buildPayPalOrderAuthorization,
  buildPayPalSplitCapturePlan,
  verifyAndDeduplicatePayPalWebhook,
  type PayPalWebhookEvent,
} from "./index.js";

describe("Floe PayPal AI Clearinghouse — Orders v2 Escrow, MCP Authority & Workbench Replay", () => {
  const policy: AgentAuthorityBudgetPolicy = {
    orgId: "org_northwind_enterprise",
    agentId: "agt_fin_support_01",
    allowedVendors: ["fin", "zendesk", "coderabbit"],
    allowedTaskTypes: ["support_resolution", "code_review"],
    maxTaskMicro: 5_000_000n,
    maxPeriodMicro: 10_000_000_000n,
    restrictedOpsRequireApproval: ["issue_refund_above_floor"],
  };

  it("enforces pre-execution MCP authority, halts unapproved restricted ops, and separates billed vs verified payable", () => {
    const allowed = handleRequestWorkAuthorization(policy, {
      requestId: "req_1",
      orgId: "org_northwind_enterprise",
      agentId: "agt_fin_support_01",
      vendor: "fin",
      taskType: "support_resolution",
      operation: "resolve_conversation",
      requestedMicro: 990_000n,
      cumulativePeriodMicro: 100_000_000n,
    });
    expect(allowed.outcome).toBe("allow");
    expect(allowed.authorizedHoldMicro).toBe(990_000n);

    const restricted = handleRequestWorkAuthorization(policy, {
      requestId: "req_2",
      orgId: "org_northwind_enterprise",
      agentId: "agt_fin_support_01",
      vendor: "fin",
      taskType: "support_resolution",
      operation: "issue_refund_above_floor",
      requestedMicro: 990_000n,
      cumulativePeriodMicro: 100_000_000n,
    });
    expect(restricted.outcome).toBe("approval_required");
    expect(restricted.authorizedHoldMicro).toBe(0n);

    // Unverified vendor claim must NEVER become payable
    const unverifiedOutcome = handleReportWorkEvidence(990_000n, {
      taskId: "tsk_unverified_1",
      authorizationTokenHash: allowed.authorizationTokenHash,
      workPerformedStatus: "completed",
      vendorBilledMicro: 990_000n,
      verificationStatus: "unverified",
      contractValid: true,
      buyerAccepted: true,
      evidenceRefs: ["ev:vendor_claim_only"],
    });
    expect(unverifiedOutcome.readyForPayableSettlement).toBe(false);
    expect(unverifiedOutcome.verifiedPayableMicro).toBe(0n);
    expect(unverifiedOutcome.heldInDisputeMicro).toBe(990_000n);

    // Verified + contract valid + buyer accepted -> ready for PayPal capture
    const verifiedOutcome = handleReportWorkEvidence(990_000n, {
      taskId: "tsk_verified_1",
      authorizationTokenHash: allowed.authorizationTokenHash,
      workPerformedStatus: "completed",
      vendorBilledMicro: 990_000n,
      verificationStatus: "verified",
      contractValid: true,
      buyerAccepted: true,
      evidenceRefs: ["ev:buyer_intercom_log_1"],
    });
    expect(verifiedOutcome.readyForPayableSettlement).toBe(true);
    expect(verifiedOutcome.verifiedPayableMicro).toBe(990_000n);
    expect(verifiedOutcome.voidExcludedMicro).toBe(0n);
  });

  it("builds deterministic PayPal Orders v2 AUTHORIZE + split CAPTURE + Disputes evidence pack", () => {
    const authPayload = buildPayPalOrderAuthorization(DEMO_CLEARED_WORK_STATEMENT);
    expect(authPayload.intent).toBe("AUTHORIZE");
    expect(authPayload.purchase_units[0].amount.value).toBe("4530.24");

    const splitPlan = buildPayPalSplitCapturePlan(
      DEMO_CLEARED_WORK_STATEMENT,
      "PAYPAL-ORDER-8841920X",
      "PAYPAL-AUTH-3391042A",
    );
    expect(splitPlan.capturePayload.amount.value).toBe("4334.22");
    expect(splitPlan.capturePayload.final_capture).toBe(false);
    expect(splitPlan.voidExcludedMicro).toBe(141_570_000n);
    expect(splitPlan.heldDisputedMicro).toBe(54_450_000n);
    expect(splitPlan.disputeEvidencePack?.excludedLines).toHaveLength(2);

    const mcpSettlement = handleSettleClearedStatement(
      DEMO_CLEARED_WORK_STATEMENT,
      "PAYPAL-ORDER-8841920X",
      "PAYPAL-AUTH-3391042A",
    );
    expect(mcpSettlement.splitCapturePlan.planHash).toBe(splitPlan.planHash);
  });

  it("verifies PayPal webhook HMAC signatures and deduplicates replayed deliveries", () => {
    const event: PayPalWebhookEvent = {
      id: "WH-2026-10-9912",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: {
        id: "CAP-8812",
        invoice_id: "CWS-2026-10-FIN-0042-v2",
        amount: { currency_code: "USD", value: "4334.22" },
      },
      create_time: "2026-10-31T02:01:00Z",
    };
    const rawBody = JSON.stringify(event);
    const secret = "whsec_test_paypal_sandbox";
    const validSig = createHmac("sha256", secret).update(rawBody).digest("hex");

    const first = verifyAndDeduplicatePayPalWebhook({
      event,
      rawBody,
      signatureHeader: validSig,
      webhookSecret: secret,
      processedEventIds: new Set(),
    });
    expect(first.verified).toBe(true);
    expect(first.duplicate).toBe(false);

    const replay = verifyAndDeduplicatePayPalWebhook({
      event,
      rawBody,
      signatureHeader: validSig,
      webhookSecret: secret,
      processedEventIds: first.nextProcessedEventIds,
    });
    expect(replay.verified).toBe(true);
    expect(replay.duplicate).toBe(true);

    const forged = verifyAndDeduplicatePayPalWebhook({
      event,
      rawBody,
      signatureHeader: "bad_signature",
      webhookSecret: secret,
      processedEventIds: new Set(),
    });
    expect(forged.verified).toBe(false);
  });

  it("runs deterministic Clearinghouse Workbench replay producing AG Grid, Bryntum & Foxit payloads", () => {
    const r1 = runClearinghouseDemoReplay();
    const r2 = runClearinghouseDemoReplay();
    expect(r1.splitPlan.planHash).toBe(r2.splitPlan.planHash);
    expect(r1.agGridRows).toHaveLength(3);
    expect(r1.bryntumTimeline).toHaveLength(4);
    expect(r1.foxitDocumentPayload.totalBilledUsd).toBe("$4530.24");
    expect(r1.foxitDocumentPayload.totalCapturedPayableUsd).toBe("$4334.22");
    expect(r1.foxitDocumentPayload.totalVoidedExcludedUsd).toBe("$141.57");
    expect(r1.foxitDocumentPayload.totalHeldDisputedUsd).toBe("$54.45");
  });
});
