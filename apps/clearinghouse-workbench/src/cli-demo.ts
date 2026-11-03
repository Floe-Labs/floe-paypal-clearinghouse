import { fileURLToPath } from "node:url";
import {
  handleReportWorkEvidence,
  handleRequestWorkAuthorization,
  type AgentAuthorityBudgetPolicy,
  type IssuedWorkAuthorization,
} from "../../../packages/agent-authority-mcp/src/index.js";
import {
  PayPalClearinghouseClient,
  buildMultiVendorPayoutBatch,
  type PayPalCaptureResponse,
} from "../../../packages/paypal-settlement-provider/src/index.js";
import { LOCKED_17_VENDORS, LOCKED_TASK_TYPES, type DemoPresetKey } from "./demo-presets.js";
import {
  getAllDemoPresetStatements,
  resolveDemoPresetStatement,
  runClearinghouseDemoReplay,
} from "./workbench-engine.js";

export interface CliDemoOptions {
  readonly preset?: DemoPresetKey;
  readonly paypalClientId?: string;
  readonly paypalClientSecret?: string;
  readonly paypalEnvironment?: "sandbox" | "live";
  readonly orderId?: string;
  readonly authorizationId?: string;
  readonly fetchFn?: typeof fetch;
}

export async function runClearinghouseCliDemo(options?: CliDemoOptions) {
  const statement = resolveDemoPresetStatement(options?.preset ?? process.env.FLOE_DEMO_PRESET);
  const store = new Map<string, IssuedWorkAuthorization>();
  const policy: AgentAuthorityBudgetPolicy = {
    orgId: "org_northwind_enterprise",
    agentId: "agt_fin_support_01",
    allowedVendors: LOCKED_17_VENDORS,
    allowedTaskTypes: LOCKED_TASK_TYPES,
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
  const suppliedOrderId = (options?.orderId ?? process.env.PAYPAL_ORDER_ID ?? "").trim();
  const suppliedAuthId = (
    options?.authorizationId ??
    process.env.PAYPAL_AUTHORIZATION_ID ??
    ""
  ).trim();

  let liveOrder: { readonly id: string; readonly status: string; readonly approveHref?: string } | null =
    null;
  let liveCapture: PayPalCaptureResponse | null = null;
  let settlementStatus:
    | "LIVE_CAPTURE_COMPLETED"
    | "ORDER_CREATED_AWAITING_BUYER_APPROVAL"
    | "SIMULATED_REPLAY" = "SIMULATED_REPLAY";

  if (clientId && clientSecret) {
    const client = new PayPalClearinghouseClient({
      clientId,
      clientSecret,
      environment,
      fetchFn: options?.fetchFn,
    });
    if (suppliedOrderId || suppliedAuthId) {
      if (!suppliedOrderId || !suppliedAuthId) {
        throw new Error(
          "Both orderId and authorizationId are required to execute live PayPal capture.",
        );
      }
      const captured = await client.captureAuthorizedWork(
        statement,
        suppliedOrderId,
        suppliedAuthId,
      );
      liveOrder = { id: suppliedOrderId, status: "COMPLETED" };
      liveCapture = captured.capture;
      settlementStatus = "LIVE_CAPTURE_COMPLETED";
    } else {
      const { order } = await client.createOrderAuthorization(statement);
      const approveLink = order.links?.find((l) => l.rel === "approve")?.href;
      liveOrder = {
        id: order.id,
        status: order.status,
        ...(approveLink ? { approveHref: approveLink } : {}),
      };
      settlementStatus = "ORDER_CREATED_AWAITING_BUYER_APPROVAL";
    }
  }

  const replay =
    settlementStatus === "LIVE_CAPTURE_COMPLETED"
      ? runClearinghouseDemoReplay(statement, {
          orderId: suppliedOrderId,
          authorizationId: suppliedAuthId,
        })
      : runClearinghouseDemoReplay(statement);

  const multiVendorBatch = buildMultiVendorPayoutBatch(
    "BATCH-2026-10-ALL-WAVES",
    getAllDemoPresetStatements(),
  );

  const mode = !liveOrder
    ? ("DETERMINISTIC_REPLAY" as const)
    : environment === "live"
      ? ("LIVE_PAYPAL_PRODUCTION" as const)
      : ("LIVE_PAYPAL_SANDBOX" as const);

  return {
    mode,
    settlementStatus,
    payeeMerchantId: statement.payeeMerchantId,
    mcpAuth,
    mcpEvidence,
    liveOrder,
    liveCapture,
    unitEconomicsAndEval: replay.unitEconomicsAndEval,
    projectedSettlement: {
      statementId: replay.statementReceiptPayload.statementId,
      replayOrderId: replay.statementReceiptPayload.payPalOrderId,
      replayAuthorizationId: replay.statementReceiptPayload.payPalAuthorizationId,
      totalBilled: replay.statementReceiptPayload.totalBilledFormatted,
      projectedCapturedPayable: replay.statementReceiptPayload.totalCapturedPayableFormatted,
      projectedVoidedExcluded: replay.statementReceiptPayload.totalVoidedExcludedFormatted,
      projectedHeldDisputed: replay.statementReceiptPayload.totalHeldDisputedFormatted,
      planHash: replay.splitPlan.planHash,
    },
    multiVendorPayoutSummary: {
      senderBatchId: multiVendorBatch.sender_batch_header.sender_batch_id,
      itemCount: multiVendorBatch.items.length,
      items: multiVendorBatch.items,
    },
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
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
