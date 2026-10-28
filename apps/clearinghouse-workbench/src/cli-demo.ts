import { fileURLToPath } from "node:url";
import {
  handleReportWorkEvidence,
  handleRequestWorkAuthorization,
  type AgentAuthorityBudgetPolicy,
  type IssuedWorkAuthorization,
} from "../../../packages/agent-authority-mcp/src/index.js";
import { PayPalClearinghouseClient } from "../../../packages/paypal-settlement-provider/src/index.js";
import { DEMO_CLEARED_WORK_STATEMENT, runClearinghouseDemoReplay } from "./workbench-engine.js";

export async function runClearinghouseCliDemo(options?: {
  readonly paypalClientId?: string;
  readonly paypalClientSecret?: string;
  readonly paypalEnvironment?: "sandbox" | "live";
  readonly fetchFn?: typeof fetch;
}) {
  const store = new Map<string, IssuedWorkAuthorization>();
  const policy: AgentAuthorityBudgetPolicy = {
    orgId: "org_northwind_enterprise",
    agentId: "agt_fin_support_01",
    allowedVendors: ["fin", "zendesk", "coderabbit"],
    allowedTaskTypes: ["support_resolution", "code_review"],
    maxTaskMicro: 5_000_000n,
    maxPeriodMicro: 10_000_000_000n,
    restrictedOpsRequireApproval: ["issue_refund_above_floor"],
  };

  const mcpAuth = handleRequestWorkAuthorization(
    policy,
    {
      requestId: "req_demo_fin_001",
      taskId: "tsk_demo_fin_001",
      orgId: "org_northwind_enterprise",
      agentId: "agt_fin_support_01",
      vendor: "fin",
      taskType: "support_resolution",
      operation: "resolve_conversation",
      requestedMicro: 990_000n,
      cumulativePeriodMicro: 4_333_230_000n,
    },
    { store },
  );

  const mcpEvidence = handleReportWorkEvidence(store, {
    taskId: "tsk_demo_fin_001",
    authorizationTokenHash: mcpAuth.authorizationTokenHash,
    workPerformedStatus: "completed",
    vendorBilledMicro: 990_000n,
    verificationStatus: "verified",
    contractValid: true,
    buyerAccepted: true,
    evidenceRefs: ["ev:intercom:conv_batch_verified_4378"],
  });

  const clientId = (options?.paypalClientId ?? process.env.PAYPAL_CLIENT_ID ?? "").trim();
  const clientSecret = (options?.paypalClientSecret ?? process.env.PAYPAL_CLIENT_SECRET ?? "").trim();
  const environment =
    options?.paypalEnvironment ??
    (process.env.PAYPAL_ENVIRONMENT === "live" ? "live" : "sandbox");

  let liveOrder: { readonly id: string; readonly status: string; readonly approveHref?: string } | null =
    null;

  if (clientId && clientSecret) {
    const client = new PayPalClearinghouseClient({
      clientId,
      clientSecret,
      environment,
      fetchFn: options?.fetchFn,
    });
    const { order } = await client.createOrderAuthorization(DEMO_CLEARED_WORK_STATEMENT);
    const approveLink = order.links?.find((l) => l.rel === "approve")?.href;
    liveOrder = {
      id: order.id,
      status: order.status,
      ...(approveLink ? { approveHref: approveLink } : {}),
    };
  }

  const replay = runClearinghouseDemoReplay(DEMO_CLEARED_WORK_STATEMENT, {
    orderId: liveOrder?.id,
  });

  return {
    mode: liveOrder ? ("LIVE_PAYPAL_SANDBOX" as const) : ("DETERMINISTIC_REPLAY" as const),
    payeeMerchantId: DEMO_CLEARED_WORK_STATEMENT.payeeMerchantId,
    mcpAuth,
    mcpEvidence,
    liveOrder,
    summary: {
      statementId: replay.statementReceiptPayload.statementId,
      payPalOrderId: replay.statementReceiptPayload.payPalOrderId,
      totalBilled: replay.statementReceiptPayload.totalBilledFormatted,
      capturedPayable: replay.statementReceiptPayload.totalCapturedPayableFormatted,
      voidedExcluded: replay.statementReceiptPayload.totalVoidedExcludedFormatted,
      heldDisputed: replay.statementReceiptPayload.totalHeldDisputedFormatted,
      planHash: replay.splitPlan.planHash,
    },
  };
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  runClearinghouseCliDemo()
    .then((res) => {
      process.stdout.write(
        JSON.stringify(res, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n",
      );
    })
    .catch((err) => {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    });
}
