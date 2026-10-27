import {
  buildPayPalOrderAuthorization,
  buildPayPalSplitCapturePlan,
  deterministicHash,
  type ClearedWorkStatementInput,
  type PayPalSplitCapturePlan,
} from "../../paypal-settlement-provider/src/index.js";

export interface AgentAuthorityBudgetPolicy {
  readonly orgId: string;
  readonly agentId: string;
  readonly allowedVendors: readonly string[];
  readonly allowedTaskTypes: readonly string[];
  readonly maxTaskMicro: bigint;
  readonly maxPeriodMicro: bigint;
  readonly restrictedOpsRequireApproval: readonly string[];
}

export interface MCPWorkAuthorizationRequest {
  readonly requestId: string;
  readonly orgId: string;
  readonly agentId: string;
  readonly vendor: string;
  readonly taskType: string;
  readonly operation: string;
  readonly requestedMicro: bigint;
  readonly cumulativePeriodMicro: bigint;
  readonly humanApprovedBy?: string;
}

export interface MCPWorkAuthorizationResponse {
  readonly outcome: "allow" | "deny" | "approval_required";
  readonly reasonCode?: string;
  readonly explanation: string;
  readonly authorizedHoldMicro: bigint;
  readonly authorizationTokenHash: string;
}

export interface MCPWorkEvidenceReport {
  readonly taskId: string;
  readonly authorizationTokenHash: string;
  readonly workPerformedStatus: "completed" | "partial" | "failed" | "unknown";
  readonly vendorBilledMicro: bigint;
  readonly verificationStatus: "verified" | "unverified" | "partial" | "unknown";
  readonly contractValid: boolean;
  readonly buyerAccepted: boolean;
  readonly exclusionReasonCode?: string;
  readonly evidenceRefs: readonly string[];
}

export interface MCPReconciledWorkOutcome {
  readonly taskId: string;
  readonly readyForPayableSettlement: boolean;
  readonly verifiedPayableMicro: bigint;
  readonly voidExcludedMicro: bigint;
  readonly heldInDisputeMicro: bigint;
  readonly reconciliationHash: string;
}

export const MCP_TOOL_MANIFEST = [
  {
    name: "request_work_authorization",
    description:
      "Request pre-execution financial authority and PayPal escrow hold before an autonomous agent performs billable AI work.",
  },
  {
    name: "report_work_evidence",
    description:
      "Submit independent buyer evidence for completed AI work, separating work performed, billed, verified, accepted, and payable.",
  },
  {
    name: "settle_cleared_statement",
    description:
      "Execute PayPal Orders v2 split CAPTURE of Verified Cleared Work and VOID/Dispute of T1-T7 excluded vendor charges.",
  },
] as const;

export function handleRequestWorkAuthorization(
  policy: AgentAuthorityBudgetPolicy,
  req: MCPWorkAuthorizationRequest,
): MCPWorkAuthorizationResponse {
  if (req.orgId !== policy.orgId || req.agentId !== policy.agentId) {
    return {
      outcome: "deny",
      reasonCode: "principal_mismatch",
      explanation: "Agent or organization principal does not match active authority policy.",
      authorizedHoldMicro: 0n,
      authorizationTokenHash: deterministicHash({ req, outcome: "deny" }),
    };
  }
  if (!policy.allowedVendors.includes(req.vendor) || !policy.allowedTaskTypes.includes(req.taskType)) {
    return {
      outcome: "deny",
      reasonCode: "usage_not_authorized",
      explanation: `Vendor '${req.vendor}' or taskType '${req.taskType}' is outside delegated authority scope.`,
      authorizedHoldMicro: 0n,
      authorizationTokenHash: deterministicHash({ req, outcome: "deny" }),
    };
  }
  if (
    req.requestedMicro > policy.maxTaskMicro ||
    req.cumulativePeriodMicro + req.requestedMicro > policy.maxPeriodMicro
  ) {
    return {
      outcome: "deny",
      reasonCode: "above_spending_cap",
      explanation: `Requested ${req.requestedMicro} micro exceeds delegated task (${policy.maxTaskMicro}) or period (${policy.maxPeriodMicro}) cap.`,
      authorizedHoldMicro: 0n,
      authorizationTokenHash: deterministicHash({ req, outcome: "deny" }),
    };
  }
  if (policy.restrictedOpsRequireApproval.includes(req.operation) && !req.humanApprovedBy?.trim()) {
    return {
      outcome: "approval_required",
      reasonCode: "human_approval_required",
      explanation: `Operation '${req.operation}' requires controller sign-off before execution.`,
      authorizedHoldMicro: 0n,
      authorizationTokenHash: deterministicHash({ req, outcome: "approval_required" }),
    };
  }

  return {
    outcome: "allow",
    explanation: `Authorized ${req.requestedMicro} micro escrow hold for ${req.vendor}/${req.taskType}.`,
    authorizedHoldMicro: req.requestedMicro,
    authorizationTokenHash: deterministicHash({
      req,
      outcome: "allow",
      authorizedHoldMicro: req.requestedMicro.toString(),
    }),
  };
}

export function handleReportWorkEvidence(
  authorizedHoldMicro: bigint,
  report: MCPWorkEvidenceReport,
): MCPReconciledWorkOutcome {
  // Core invariant: Work performed != Billed != Verified != Accepted != Payable.
  // Never pay unverified claims or contract-invalid charges.
  const readyForPayableSettlement =
    report.workPerformedStatus === "completed" &&
    report.verificationStatus === "verified" &&
    report.contractValid &&
    report.buyerAccepted;

  const verifiedPayableMicro = readyForPayableSettlement
    ? report.vendorBilledMicro <= authorizedHoldMicro
      ? report.vendorBilledMicro
      : authorizedHoldMicro
    : 0n;

  const isUnverifiedOrPending =
    report.verificationStatus === "unverified" || report.verificationStatus === "partial";

  const heldInDisputeMicro =
    !readyForPayableSettlement && isUnverifiedOrPending ? report.vendorBilledMicro : 0n;

  const voidExcludedMicro =
    report.vendorBilledMicro - verifiedPayableMicro - heldInDisputeMicro;

  const base = {
    taskId: report.taskId,
    readyForPayableSettlement,
    verifiedPayableMicro,
    voidExcludedMicro,
    heldInDisputeMicro,
    exclusionReasonCode: report.exclusionReasonCode ?? null,
    evidenceRefs: report.evidenceRefs,
  };

  return {
    taskId: report.taskId,
    readyForPayableSettlement,
    verifiedPayableMicro,
    voidExcludedMicro,
    heldInDisputeMicro,
    reconciliationHash: deterministicHash(base),
  };
}

export function handleSettleClearedStatement(
  statement: ClearedWorkStatementInput,
  orderId: string,
  authorizationId: string,
): {
  readonly orderAuthPayload: ReturnType<typeof buildPayPalOrderAuthorization>;
  readonly splitCapturePlan: PayPalSplitCapturePlan;
} {
  const orderAuthPayload = buildPayPalOrderAuthorization(statement);
  const splitCapturePlan = buildPayPalSplitCapturePlan(statement, orderId, authorizationId);
  return { orderAuthPayload, splitCapturePlan };
}
