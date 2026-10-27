import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DEMO_CLEARED_WORK_STATEMENT,
  runClearinghouseDemoReplay,
} from "../../../apps/clearinghouse-workbench/src/workbench-engine.js";
import {
  createHumanApprovalProof,
  handleMcpJsonRpcRequest,
  handleReportWorkEvidence,
  handleRequestWorkAuthorization,
  handleSettleClearedStatement,
  type AgentAuthorityBudgetPolicy,
  type IssuedWorkAuthorization,
} from "../../agent-authority-mcp/src/index.js";
import {
  buildMultiVendorPayoutBatch,
  buildPayPalOrderAuthorization,
  buildPayPalSplitCapturePlan,
  crc32Decimal,
  deterministicHash,
  verifyAndDeduplicatePayPalWebhook,
  type ClearedWorkStatementInput,
  type PayPalWebhookEvent,
} from "./index.js";

describe("Floe PayPal AI Clearinghouse — Orders v2 Escrow, MCP Authority & Workbench Replay", () => {
  const approvalSecret = "test_controller_approval_secret_v1";
  const policy: AgentAuthorityBudgetPolicy = {
    orgId: "org_northwind_enterprise",
    agentId: "agt_fin_support_01",
    allowedVendors: ["fin", "zendesk", "coderabbit"],
    allowedTaskTypes: ["support_resolution", "code_review"],
    maxTaskMicro: 5_000_000n,
    maxPeriodMicro: 10_000_000_000n,
    restrictedOpsRequireApproval: ["issue_refund_above_floor"],
    authorizedApprovers: ["controller_alice"],
    approvalSecret,
  };

  it("enforces pre-execution MCP authority, verified human approval proofs, and server-side token store in handleReportWorkEvidence", () => {
    const store = new Map<string, IssuedWorkAuthorization>();

    expect(() =>
      handleRequestWorkAuthorization(policy, {
        requestId: "req_neg",
        orgId: "org_northwind_enterprise",
        agentId: "agt_fin_support_01",
        vendor: "fin",
        taskType: "support_resolution",
        operation: "resolve_conversation",
        requestedMicro: 0n,
        cumulativePeriodMicro: 100_000_000n,
      }),
    ).toThrow(/requestedMicro must be positive/);

    const allowed = handleRequestWorkAuthorization(
      policy,
      {
        requestId: "req_1",
        taskId: "tsk_1",
        orgId: "org_northwind_enterprise",
        agentId: "agt_fin_support_01",
        vendor: "fin",
        taskType: "support_resolution",
        operation: "resolve_conversation",
        requestedMicro: 990_000n,
        cumulativePeriodMicro: 100_000_000n,
      },
      { store },
    );
    expect(allowed.outcome).toBe("allow");
    expect(allowed.authorizedHoldMicro).toBe(990_000n);

    const restrictedReq = {
      requestId: "req_2",
      orgId: "org_northwind_enterprise",
      agentId: "agt_fin_support_01",
      vendor: "fin",
      taskType: "support_resolution",
      operation: "issue_refund_above_floor",
      requestedMicro: 990_000n,
      cumulativePeriodMicro: 100_000_000n,
    };
    const restricted = handleRequestWorkAuthorization(policy, restrictedReq, { store });
    expect(restricted.outcome).toBe("approval_required");
    expect(restricted.authorizedHoldMicro).toBe(0n);

    const forgedApproval = handleRequestWorkAuthorization(policy, {
      ...restrictedReq,
      humanApprovalProof: { approverId: "controller_alice", signature: "deadbeef".repeat(8) },
    });
    expect(forgedApproval.outcome).toBe("approval_required");

    const validProof = createHumanApprovalProof(restrictedReq, "controller_alice", approvalSecret);
    const approvedRestricted = handleRequestWorkAuthorization(policy, {
      ...restrictedReq,
      humanApprovalProof: validProof,
    });
    expect(approvedRestricted.outcome).toBe("allow");

    const unverifiedOutcome = handleReportWorkEvidence(store, {
      taskId: "tsk_1",
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

    expect(() =>
      handleReportWorkEvidence(store, {
        taskId: "tsk_1",
        authorizationTokenHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        workPerformedStatus: "completed",
        vendorBilledMicro: 990_000n,
        verificationStatus: "verified",
        contractValid: true,
        buyerAccepted: true,
        evidenceRefs: ["ev:buyer_intercom_log_1"],
      }),
    ).toThrow(/Unrecognized or non-authorized token hash/);

    const verifiedOutcome = handleReportWorkEvidence(store, {
      taskId: "tsk_1",
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

    const listResp = handleMcpJsonRpcRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { policy, store });
    expect((listResp.result as { tools: unknown[] }).tools).toHaveLength(3);
  });

  it("builds deterministic PayPal Orders v2 AUTHORIZE + split CAPTURE + Disputes pack and handles 0-capture / unverified lines", () => {
    expect(() => deterministicHash(undefined)).toThrow(/Cannot compute deterministicHash/);

    const authPayload = buildPayPalOrderAuthorization(DEMO_CLEARED_WORK_STATEMENT);
    expect(authPayload.intent).toBe("AUTHORIZE");
    expect(authPayload.purchase_units[0].amount.value).toBe("4530.24");

    const splitPlan = buildPayPalSplitCapturePlan(
      DEMO_CLEARED_WORK_STATEMENT,
      "PAYPAL-ORDER-8841920X",
      "PAYPAL-AUTH-3391042A",
    );
    expect(splitPlan.capturePayload?.amount.value).toBe("4334.22");
    expect(splitPlan.capturePayload?.final_capture).toBe(false);
    expect(splitPlan.voidExcludedMicro).toBe(141_570_000n);
    expect(splitPlan.heldDisputedMicro).toBe(54_450_000n);
    expect(splitPlan.disputeEvidencePack?.excludedLines).toHaveLength(2);

    const zeroPayableStmt: ClearedWorkStatementInput = {
      ...DEMO_CLEARED_WORK_STATEMENT,
      statementId: "CWS-ZERO-PAYABLE",
      lines: [{
        lineKey: "L_EXCLUDED_ALL",
        description: "100% excluded",
        billedMicro: 100_000_000n,
        clearedPayableMicro: 0n,
        excludedCreditMicro: 100_000_000n,
        heldInDisputeMicro: 0n,
        tClass: "T5",
        reasonCode: "same_conversation_return",
        evidenceRefs: ["ev:1"],
      }],
    };
    expect(buildPayPalSplitCapturePlan(zeroPayableStmt, "ORD-0", "AUTH-0").capturePayload).toBeNull();
    expect(buildMultiVendorPayoutBatch("BATCH-1", [DEMO_CLEARED_WORK_STATEMENT, zeroPayableStmt]).items).toHaveLength(1);

    expect(() =>
      buildPayPalOrderAuthorization({
        ...DEMO_CLEARED_WORK_STATEMENT,
        lines: [{
          lineKey: "L_UNVERIFIED_PAYABLE",
          description: "Unverified line marked payable",
          billedMicro: 100_000_000n,
          clearedPayableMicro: 100_000_000n,
          excludedCreditMicro: 0n,
          heldInDisputeMicro: 0n,
          verified: false,
          evidenceRefs: ["ev:bad"],
        }],
      }),
    ).toThrow(/Verification gate violation/);

    const mcpSettlement = handleSettleClearedStatement(
      DEMO_CLEARED_WORK_STATEMENT,
      "PAYPAL-ORDER-8841920X",
      "PAYPAL-AUTH-3391042A",
    );
    expect(mcpSettlement.splitCapturePlan.planHash).toBe(splitPlan.planHash);
  });

  it("verifies PayPal RSA-SHA256 webhook transmission signatures, rejects untrusted certUrl or tampered rawBody, and deduplicates atomically", () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

    const event: PayPalWebhookEvent = {
      id: "WH-2026-10-9912",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: { id: "CAP-8812", invoice_id: "CWS-2026-10-FIN-0042-v2", amount: { currency_code: "USD", value: "4334.22" } },
      create_time: "2026-10-31T02:01:00Z",
    };
    const rawBody = JSON.stringify(event);
    const transmissionId = "69cd13f0-d67a-11ef-9b1c-0123456789ab";
    const transmissionTime = "2026-10-31T02:01:02Z";
    const webhookId = "5GP028498E3491206";
    const message = `${transmissionId}|${transmissionTime}|${webhookId}|${crc32Decimal(rawBody)}`;
    const signer = createSign("RSA-SHA256");
    signer.update(message, "utf8");
    signer.end();
    const validSig = signer.sign(privateKey, "base64");

    const headers = {
      transmissionId,
      transmissionTime,
      transmissionSig: validSig,
      certUrl: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-1d93a270",
      authAlgo: "SHA256withRSA",
    };

    const claimedIds = new Set<string>();
    const claimEventId = (id: string) => {
      if (claimedIds.has(id)) return false;
      claimedIds.add(id);
      return true;
    };

    const first = verifyAndDeduplicatePayPalWebhook({ rawBody, headers, webhookId, paypalPublicKeyPem: publicKeyPem, claimEventId });
    expect(first.verified).toBe(true);
    expect(first.duplicate).toBe(false);
    expect(first.event?.id).toBe(event.id);

    const replay = verifyAndDeduplicatePayPalWebhook({ rawBody, headers, webhookId, paypalPublicKeyPem: publicKeyPem, claimEventId });
    expect(replay.verified).toBe(true);
    expect(replay.duplicate).toBe(true);

    const untrustedCert = verifyAndDeduplicatePayPalWebhook({
      rawBody,
      headers: { ...headers, certUrl: "https://evil.example.com/cert.pem" },
      webhookId,
      paypalPublicKeyPem: publicKeyPem,
    });
    expect(untrustedCert.verified).toBe(false);

    const sameLengthBadSig = validSig.slice(0, -4) + (validSig.endsWith("AAAA") ? "BBBB" : "AAAA");
    const forged = verifyAndDeduplicatePayPalWebhook({
      rawBody,
      headers: { ...headers, transmissionSig: sameLengthBadSig },
      webhookId,
      paypalPublicKeyPem: publicKeyPem,
    });
    expect(forged.verified).toBe(false);
  });

  it("runs deterministic Clearinghouse Workbench replay producing AG Grid, Bryntum & Foxit payloads across currencies and settlement modes", () => {
    const r1 = runClearinghouseDemoReplay();
    const r2 = runClearinghouseDemoReplay();
    expect(r1.splitPlan.planHash).toBe(r2.splitPlan.planHash);
    expect(r1.payoutBatch).toBeNull();
    expect(r1.agGridRows).toHaveLength(3);
    expect(r1.bryntumTimeline).toHaveLength(4);
    expect(r1.foxitDocumentPayload.totalBilledFormatted).toBe("$4530.24");
    expect(r1.foxitDocumentPayload.totalCapturedPayableFormatted).toBe("$4334.22");
    expect(r1.foxitDocumentPayload.totalVoidedExcludedFormatted).toBe("$141.57");
    expect(r1.foxitDocumentPayload.totalHeldDisputedFormatted).toBe("$54.45");

    const eurReplay = runClearinghouseDemoReplay(
      { ...DEMO_CLEARED_WORK_STATEMENT, currency: "EUR" },
      { settlementMode: "MULTI_VENDOR_PAYOUT" },
    );
    expect(eurReplay.foxitDocumentPayload.totalBilledFormatted).toBe("€4530.24");
    expect(eurReplay.payoutBatch?.items).toHaveLength(1);
  });
});
