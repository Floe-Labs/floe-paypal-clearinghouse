import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { createHumanApprovalProof } from "../../../packages/agent-authority-mcp/src/index.js";
import { runClearinghouseCliDemo } from "./cli-demo.js";
import { createClearinghouseRequestHandler, startClearinghouseServer } from "./server.js";
import { DEMO_CLEARED_WORK_STATEMENT, runClearinghouseDemoReplay } from "./workbench-engine.js";

function invokeHandler(
  handler: ReturnType<typeof createClearinghouseRequestHandler>,
  method: string,
  url: string,
  bodyObj?: unknown,
): Promise<{ readonly statusCode: number; readonly headers: Record<string, string>; readonly body: string }> {
  return new Promise((resolve, reject) => {
    const rawBody = bodyObj !== undefined ? JSON.stringify(bodyObj) : "";
    const stream = Readable.from(rawBody ? [Buffer.from(rawBody, "utf8")] : []);
    const req = Object.assign(stream, {
      method,
      url,
      headers: { "content-type": "application/json" },
    }) as unknown as IncomingMessage;

    let statusCode = 200;
    let respHeaders: Record<string, string> = {};
    const chunks: string[] = [];

    const res = {
      writeHead(code: number, headers?: Record<string, string>) {
        statusCode = code;
        if (headers) respHeaders = headers;
        return this;
      },
      end(chunk?: string) {
        if (chunk) chunks.push(chunk);
        resolve({ statusCode, headers: respHeaders, body: chunks.join("") });
      },
    } as unknown as ServerResponse;

    handler(req, res).catch(reject);
  });
}

describe("Floe Clearinghouse Interactive Workbench Server & CLI Demo", () => {
  it("serves AG Grid + BryntumTimelineMilestone HTML dashboard with environment-specific badges and rejects partial replay override IDs", async () => {
    expect(() =>
      runClearinghouseDemoReplay(DEMO_CLEARED_WORK_STATEMENT, { orderId: "ONLY-ORDER" }),
    ).toThrow(/Both orderId and authorizationId must be provided together/);

    expect(() => startClearinghouseServer(0, "0.0.0.0")).toThrow(
      /Refusing to bind Clearinghouse Workbench to non-loopback host/,
    );

    const replayHandler = createClearinghouseRequestHandler({ paypalClientId: "", paypalClientSecret: "" });
    const htmlReplay = await invokeHandler(replayHandler, "GET", "/");
    expect(htmlReplay.statusCode).toBe(200);
    expect(htmlReplay.body).toContain("ag-grid-community");
    expect(htmlReplay.body).toContain("Deterministic Replay Mode");

    const prodHandler = createClearinghouseRequestHandler({
      paypalClientId: "cid",
      paypalClientSecret: "csec",
      paypalEnvironment: "live",
    });
    const htmlProd = await invokeHandler(prodHandler, "GET", "/");
    expect(htmlProd.body).toContain("PayPal Production API Connected");

    const replayRes = await invokeHandler(replayHandler, "GET", "/api/replay");
    expect(replayRes.statusCode).toBe(200);
    const replayJson = JSON.parse(replayRes.body) as {
      agGridRows: unknown[];
      bryntumTimeline: unknown[];
      statementReceiptPayload: { totalBilledFormatted: string; totalCapturedPayableFormatted: string };
    };
    expect(replayJson.agGridRows).toHaveLength(3);
    expect(replayJson.bryntumTimeline).toHaveLength(4);
    expect(replayJson.statementReceiptPayload.totalBilledFormatted).toBe("$4530.24");
  });

  it("validates JSON-RPC 2.0 requests, rejects unsafe numeric amounts, derives period spend from server state, normalizes custom statement lines, and fails closed without approvalSecret", async () => {
    const handlerNoSecret = createClearinghouseRequestHandler({ approvalSecret: "" });

    const invalidRpc = await invokeHandler(handlerNoSecret, "POST", "/api/mcp", {
      jsonrpc: "1.0",
      id: "bad-1",
    });
    expect(invalidRpc.statusCode).toBe(400);

    const unsafeNumRes = await invokeHandler(handlerNoSecret, "POST", "/api/mcp", {
      jsonrpc: "2.0",
      id: "unsafe-1",
      method: "tools/call",
      params: {
        name: "request_work_authorization",
        arguments: {
          requestId: "req_u",
          orgId: "org_northwind_enterprise",
          agentId: "agt_fin_support_01",
          vendor: "fin",
          taskType: "support_resolution",
          operation: "resolve_conversation",
          requestedMicro: Number.MAX_SAFE_INTEGER + 2,
        },
      },
    });
    expect(unsafeNumRes.statusCode).toBe(400);
    expect(unsafeNumRes.body).toContain("must be an integer string or safe integer");

    // Restricted op fails closed when approvalSecret is not configured, even if caller sends a proof
    const forgedProof = createHumanApprovalProof(
      {
        requestId: "req_r1",
        orgId: "org_northwind_enterprise",
        agentId: "agt_fin_support_01",
        operation: "issue_refund_above_floor",
        requestedMicro: 1_000_000n,
      },
      "controller_alice",
      "any_secret",
    );
    const restrictedDenied = await invokeHandler(handlerNoSecret, "POST", "/api/mcp", {
      jsonrpc: "2.0",
      id: "rpc-r1",
      method: "tools/call",
      params: {
        name: "request_work_authorization",
        arguments: {
          requestId: "req_r1",
          orgId: "org_northwind_enterprise",
          agentId: "agt_fin_support_01",
          vendor: "fin",
          taskType: "support_resolution",
          operation: "issue_refund_above_floor",
          requestedMicro: "1000000",
          humanApprovalProof: forgedProof,
        },
      },
    });
    expect(JSON.parse(restrictedDenied.body).result.outcome).toBe("approval_required");

    // Server derives cumulativePeriodMicro from store and normalizes custom statement lines
    const secret = "deploy_approval_secret_99";
    const handlerWithSecret = createClearinghouseRequestHandler({ approvalSecret: secret });
    const validProof = createHumanApprovalProof(
      {
        requestId: "req_r2",
        orgId: "org_northwind_enterprise",
        agentId: "agt_fin_support_01",
        operation: "issue_refund_above_floor",
        requestedMicro: 1_000_000n,
      },
      "controller_alice",
      secret,
    );
    const restrictedAllowed = await invokeHandler(handlerWithSecret, "POST", "/api/mcp", {
      jsonrpc: "2.0",
      id: "rpc-r2",
      method: "tools/call",
      params: {
        name: "request_work_authorization",
        arguments: {
          requestId: "req_r2",
          orgId: "org_northwind_enterprise",
          agentId: "agt_fin_support_01",
          vendor: "fin",
          taskType: "support_resolution",
          operation: "issue_refund_above_floor",
          requestedMicro: "1000000",
          cumulativePeriodMicro: "0",
          humanApprovalProof: validProof,
        },
      },
    });
    expect(JSON.parse(restrictedAllowed.body).result.outcome).toBe("allow");

    const customSettleRes = await invokeHandler(handlerWithSecret, "POST", "/api/mcp", {
      jsonrpc: "2.0",
      id: "rpc-settle-custom",
      method: "tools/call",
      params: {
        name: "settle_cleared_work",
        arguments: {
          orderId: "ORD-CUSTOM-1",
          authorizationId: "AUTH-CUSTOM-1",
          statement: {
            ...DEMO_CLEARED_WORK_STATEMENT,
            lines: [
              {
                lineKey: "L_CUSTOM",
                description: "Custom JSON line",
                billedMicro: "2000000",
                clearedPayableMicro: "2000000",
                excludedCreditMicro: "0",
                heldInDisputeMicro: "0",
                verified: true,
                contractValid: true,
                buyerAccepted: true,
                evidenceRefs: ["ev:1"],
              },
            ],
          },
        },
      },
    });
    expect(customSettleRes.statusCode).toBe(200);
    expect(JSON.parse(customSettleRes.body).result.splitCapturePlan.capturePayableMicro).toBe("2000000");
  });

  it("separates order creation from live capture and labels sandbox vs production accurately", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/v1/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "tok_sandbox_1", expires_in: 3600 }), { status: 200 });
      }
      if (url.includes("/v2/payments/authorizations/")) {
        return new Response(
          JSON.stringify({
            id: "CAP-LIVE-77",
            status: "COMPLETED",
            final_capture: false,
            amount: { currency_code: "USD", value: "4334.22" },
          }),
          { status: 201 },
        );
      }
      return new Response(
        JSON.stringify({
          id: "9XJ11223344556677",
          status: "CREATED",
          links: [{ href: "https://www.sandbox.paypal.com/checkoutnow?token=9XJ11223344556677", rel: "approve", method: "GET" }],
        }),
        { status: 201 },
      );
    };

    const liveHandler = createClearinghouseRequestHandler({
      paypalClientId: "test_client",
      paypalClientSecret: "test_secret",
      paypalEnvironment: "sandbox",
      fetchFn: mockFetch,
    });

    // 1. Order creation keeps created order separate from projectedReplay
    const createRes = await invokeHandler(liveHandler, "POST", "/api/paypal/authorize", {});
    expect(createRes.statusCode).toBe(200);
    const createBody = JSON.parse(createRes.body) as {
      mode: string;
      settlementStatus: string;
      order: { id: string };
      projectedReplay: { statementReceiptPayload: { payPalOrderId: string } };
    };
    expect(createBody.mode).toBe("LIVE_PAYPAL_SANDBOX");
    expect(createBody.settlementStatus).toBe("ORDER_CREATED_AWAITING_BUYER_APPROVAL");
    expect(createBody.order.id).toBe("9XJ11223344556677");
    expect(createBody.projectedReplay.statementReceiptPayload.payPalOrderId).toBe("PAYPAL-ORDER-8841920X");

    // 2. Supplying both orderId and authorizationId executes live capture and binds real IDs into replay
    const captureRes = await invokeHandler(liveHandler, "POST", "/api/paypal/authorize", {
      orderId: "9XJ11223344556677",
      authorizationId: "AUTH-REAL-991",
    });
    expect(captureRes.statusCode).toBe(200);
    const captureBody = JSON.parse(captureRes.body) as {
      settlementStatus: string;
      capture: { id: string };
      replay: { statementReceiptPayload: { payPalOrderId: string; payPalAuthorizationId: string } };
    };
    expect(captureBody.settlementStatus).toBe("LIVE_CAPTURE_COMPLETED");
    expect(captureBody.capture.id).toBe("CAP-LIVE-77");
    expect(captureBody.replay.statementReceiptPayload.payPalOrderId).toBe("9XJ11223344556677");
    expect(captureBody.replay.statementReceiptPayload.payPalAuthorizationId).toBe("AUTH-REAL-991");

    // 3. CLI demo distinguishes sandbox vs production and order creation vs live capture
    const cliProdOrder = await runClearinghouseCliDemo({
      paypalClientId: "test_client",
      paypalClientSecret: "test_secret",
      paypalEnvironment: "live",
      fetchFn: mockFetch,
    });
    expect(cliProdOrder.mode).toBe("LIVE_PAYPAL_PRODUCTION");
    expect(cliProdOrder.settlementStatus).toBe("ORDER_CREATED_AWAITING_BUYER_APPROVAL");
    expect(cliProdOrder.projectedSettlement.replayOrderId).toBe("PAYPAL-ORDER-8841920X");

    const cliLiveCaptured = await runClearinghouseCliDemo({
      paypalClientId: "test_client",
      paypalClientSecret: "test_secret",
      paypalEnvironment: "sandbox",
      orderId: "9XJ11223344556677",
      authorizationId: "AUTH-REAL-991",
      fetchFn: mockFetch,
    });
    expect(cliLiveCaptured.mode).toBe("LIVE_PAYPAL_SANDBOX");
    expect(cliLiveCaptured.settlementStatus).toBe("LIVE_CAPTURE_COMPLETED");
    expect(cliLiveCaptured.liveCapture?.id).toBe("CAP-LIVE-77");
    expect(cliLiveCaptured.projectedSettlement.replayOrderId).toBe("9XJ11223344556677");
    expect(cliLiveCaptured.projectedSettlement.replayAuthorizationId).toBe("AUTH-REAL-991");
  });
});
