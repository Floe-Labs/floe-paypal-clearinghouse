import { createHmac, timingSafeEqual } from "node:crypto";
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
  readonly authorizedApprovers?: readonly string[];
  readonly approvalSecret?: string;
}

export interface HumanApprovalProof {
  readonly approverId: string;
  readonly signature: string;
}

export interface MCPWorkAuthorizationRequest {
  readonly requestId: string;
  readonly taskId?: string;
  readonly orgId: string;
  readonly agentId: string;
  readonly vendor: string;
  readonly taskType: string;
  readonly operation: string;
  readonly requestedMicro: bigint;
  readonly cumulativePeriodMicro: bigint;
  readonly humanApprovalProof?: HumanApprovalProof;
}

export interface MCPWorkAuthorizationResponse {
  readonly outcome: "allow" | "deny" | "approval_required";
  readonly reasonCode?: string;
  readonly explanation: string;
  readonly authorizedHoldMicro: bigint;
  readonly authorizationTokenHash: string;
}

export interface IssuedWorkAuthorization {
  readonly tokenHash: string;
  readonly requestId: string;
  readonly taskId: string;
  readonly orgId: string;
  readonly agentId: string;
  readonly outcome: "allow" | "deny" | "approval_required";
  readonly authorizedHoldMicro: bigint;
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

const DEFAULT_APPROVAL_SECRET = "floe_default_controller_approval_secret_v1";

export function createHumanApprovalProof(
  req: Pick<MCPWorkAuthorizationRequest, "requestId" | "orgId" | "agentId" | "operation" | "requestedMicro">,
  approverId: string,
  approvalSecret: string = DEFAULT_APPROVAL_SECRET,
): HumanApprovalProof {
  const payload = `${req.requestId}|${req.orgId}|${req.agentId}|${req.operation}|${req.requestedMicro.toString()}|${approverId}`;
  return { approverId, signature: createHmac("sha256", approvalSecret).update(payload, "utf8").digest("hex") };
}

function verifyHumanApprovalProof(
  policy: AgentAuthorityBudgetPolicy,
  req: MCPWorkAuthorizationRequest,
  overrideSecret?: string,
): boolean {
  const proof = req.humanApprovalProof;
  if (!proof || !proof.approverId.trim() || !proof.signature.trim()) return false;
  if (policy.authorizedApprovers && !policy.authorizedApprovers.includes(proof.approverId)) return false;
  const secret = overrideSecret ?? policy.approvalSecret ?? DEFAULT_APPROVAL_SECRET;
  const expected = createHumanApprovalProof(req, proof.approverId, secret).signature;
  const actualBuf = Buffer.from(proof.signature, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  return actualBuf.length === expectedBuf.length && timingSafeEqual(actualBuf, expectedBuf);
}

export const MCP_TOOL_MANIFEST = [
  {
    name: "request_work_authorization",
    description: "Request pre-execution financial authority and PayPal escrow hold before an autonomous agent performs billable AI work.",
    inputSchema: { type: "object", required: ["requestId", "orgId", "agentId", "vendor", "taskType", "operation", "requestedMicro", "cumulativePeriodMicro"] },
  },
  {
    name: "report_work_evidence",
    description: "Submit independent buyer evidence for completed AI work, separating work performed, billed, verified, accepted, and payable.",
    inputSchema: { type: "object", required: ["taskId", "authorizationTokenHash", "workPerformedStatus", "vendorBilledMicro", "verificationStatus", "contractValid", "buyerAccepted", "evidenceRefs"] },
  },
  {
    name: "settle_cleared_work",
    description: "Execute PayPal Orders v2 split CAPTURE of Verified Cleared Work and VOID/Dispute of T1-T7 excluded vendor charges.",
    inputSchema: { type: "object", required: ["statement", "orderId", "authorizationId"] },
  },
] as const;

export function handleRequestWorkAuthorization(
  policy: AgentAuthorityBudgetPolicy,
  req: MCPWorkAuthorizationRequest,
  options?: { readonly approvalSecret?: string; readonly store?: Map<string, IssuedWorkAuthorization> },
): MCPWorkAuthorizationResponse {
  if (req.requestedMicro <= 0n || req.cumulativePeriodMicro < 0n) {
    throw new Error("Invalid monetary request: requestedMicro must be positive and cumulativePeriodMicro must be non-negative.");
  }
  const recordDecision = (resp: MCPWorkAuthorizationResponse): MCPWorkAuthorizationResponse => {
    options?.store?.set(resp.authorizationTokenHash, {
      tokenHash: resp.authorizationTokenHash,
      requestId: req.requestId,
      taskId: req.taskId ?? req.requestId,
      orgId: req.orgId,
      agentId: req.agentId,
      outcome: resp.outcome,
      authorizedHoldMicro: resp.authorizedHoldMicro,
    });
    return resp;
  };
  if (req.orgId !== policy.orgId || req.agentId !== policy.agentId) {
    return recordDecision({
      outcome: "deny",
      reasonCode: "principal_mismatch",
      explanation: "Agent or organization principal does not match active authority policy.",
      authorizedHoldMicro: 0n,
      authorizationTokenHash: deterministicHash({ req, outcome: "deny" }),
    });
  }
  if (!policy.allowedVendors.includes(req.vendor) || !policy.allowedTaskTypes.includes(req.taskType)) {
    return recordDecision({
      outcome: "deny",
      reasonCode: "usage_not_authorized",
      explanation: `Vendor '${req.vendor}' or taskType '${req.taskType}' is outside delegated authority scope.`,
      authorizedHoldMicro: 0n,
      authorizationTokenHash: deterministicHash({ req, outcome: "deny" }),
    });
  }
  if (req.requestedMicro > policy.maxTaskMicro || req.cumulativePeriodMicro + req.requestedMicro > policy.maxPeriodMicro) {
    return recordDecision({
      outcome: "deny",
      reasonCode: "above_spending_cap",
      explanation: `Requested ${req.requestedMicro} micro exceeds delegated task (${policy.maxTaskMicro}) or period (${policy.maxPeriodMicro}) cap.`,
      authorizedHoldMicro: 0n,
      authorizationTokenHash: deterministicHash({ req, outcome: "deny" }),
    });
  }
  if (policy.restrictedOpsRequireApproval.includes(req.operation) && !verifyHumanApprovalProof(policy, req, options?.approvalSecret)) {
    return recordDecision({
      outcome: "approval_required",
      reasonCode: "human_approval_required",
      explanation: `Operation '${req.operation}' requires verified controller sign-off before execution.`,
      authorizedHoldMicro: 0n,
      authorizationTokenHash: deterministicHash({ req, outcome: "approval_required" }),
    });
  }
  return recordDecision({
    outcome: "allow",
    explanation: `Authorized ${req.requestedMicro} micro escrow hold for ${req.vendor}/${req.taskType}.`,
    authorizedHoldMicro: req.requestedMicro,
    authorizationTokenHash: deterministicHash({ req, outcome: "allow", authorizedHoldMicro: req.requestedMicro.toString() }),
  });
}

export function handleReportWorkEvidence(
  authorizationSource: bigint | ReadonlyMap<string, IssuedWorkAuthorization>,
  report: MCPWorkEvidenceReport,
): MCPReconciledWorkOutcome {
  if (report.vendorBilledMicro < 0n) throw new Error("Invalid evidence report: vendorBilledMicro cannot be negative.");
  if (!report.authorizationTokenHash.startsWith("sha256:")) throw new Error("Invalid authorizationTokenHash format.");
  let authorizedHoldMicro: bigint;
  if (typeof authorizationSource === "bigint") {
    if (authorizationSource < 0n) throw new Error("authorizedHoldMicro cannot be negative.");
    authorizedHoldMicro = authorizationSource;
  } else {
    const issued = authorizationSource.get(report.authorizationTokenHash);
    if (!issued || issued.outcome !== "allow") {
      throw new Error(`Unrecognized or non-authorized token hash: ${report.authorizationTokenHash}`);
    }
    if (issued.taskId !== report.taskId) {
      throw new Error(`Authorization token taskId (${issued.taskId}) does not match evidence taskId (${report.taskId}).`);
    }
    authorizedHoldMicro = issued.authorizedHoldMicro;
  }
  const readyForPayableSettlement =
    report.workPerformedStatus === "completed" &&
    report.verificationStatus === "verified" &&
    report.contractValid &&
    report.buyerAccepted;
  const verifiedPayableMicro = readyForPayableSettlement
    ? report.vendorBilledMicro <= authorizedHoldMicro ? report.vendorBilledMicro : authorizedHoldMicro
    : 0n;
  const isUnverifiedOrPending = report.verificationStatus === "unverified" || report.verificationStatus === "partial";
  const heldInDisputeMicro = !readyForPayableSettlement && isUnverifiedOrPending ? report.vendorBilledMicro : 0n;
  const voidExcludedMicro = report.vendorBilledMicro - verifiedPayableMicro - heldInDisputeMicro;
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
): { readonly orderAuthPayload: ReturnType<typeof buildPayPalOrderAuthorization>; readonly splitCapturePlan: PayPalSplitCapturePlan } {
  return {
    orderAuthPayload: buildPayPalOrderAuthorization(statement),
    splitCapturePlan: buildPayPalSplitCapturePlan(statement, orderId, authorizationId),
  };
}

export const handleSettleClearedWork = handleSettleClearedStatement;

export interface McpJsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: string | number;
  readonly method: "initialize" | "tools/list" | "tools/call";
  readonly params?: Record<string, unknown>;
}

export interface McpJsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

export function handleMcpJsonRpcRequest(
  req: McpJsonRpcRequest,
  ctx: { readonly policy: AgentAuthorityBudgetPolicy; readonly store: Map<string, IssuedWorkAuthorization>; readonly approvalSecret?: string },
): McpJsonRpcResponse {
  try {
    if (req.method === "initialize") {
      return { jsonrpc: "2.0", id: req.id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "@floe/agent-authority-mcp", version: "0.1.0" }, capabilities: { tools: {} } } };
    }
    if (req.method === "tools/list") return { jsonrpc: "2.0", id: req.id, result: { tools: MCP_TOOL_MANIFEST } };
    if (req.method === "tools/call") {
      const name = req.params?.name as string | undefined;
      const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
      if (name === "request_work_authorization") {
        return { jsonrpc: "2.0", id: req.id, result: handleRequestWorkAuthorization(ctx.policy, args as unknown as MCPWorkAuthorizationRequest, { store: ctx.store, approvalSecret: ctx.approvalSecret }) };
      }
      if (name === "report_work_evidence") {
        return { jsonrpc: "2.0", id: req.id, result: handleReportWorkEvidence(ctx.store, args as unknown as MCPWorkEvidenceReport) };
      }
      if (name === "settle_cleared_work" || name === "settle_cleared_statement") {
        return { jsonrpc: "2.0", id: req.id, result: handleSettleClearedStatement(args.statement as ClearedWorkStatementInput, String(args.orderId), String(args.authorizationId)) };
      }
      return { jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `Unknown MCP tool: ${String(name)}` } };
    }
    return { jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `Unsupported method: ${String(req.method)}` } };
  } catch (err) {
    return { jsonrpc: "2.0", id: req.id, error: { code: -32602, message: err instanceof Error ? err.message : String(err) } };
  }
}
