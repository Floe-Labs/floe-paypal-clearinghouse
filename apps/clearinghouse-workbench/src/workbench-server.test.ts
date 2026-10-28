import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { runClearinghouseCliDemo } from "./cli-demo.js";
import { createClearinghouseRequestHandler } from "./server.js";

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
  it("serves interactive AG Grid + Bryntum Milestone HTML dashboard and deterministic /api/replay", async () => {
    const handler = createClearinghouseRequestHandler();

    const htmlRes = await invokeHandler(handler, "GET", "/");
    expect(htmlRes.statusCode).toBe(200);
    expect(htmlRes.body).toContain("ag-grid-community");
    expect(htmlRes.body).toContain("CWS-2026-10-FIN-0042");
    expect(htmlRes.body).toContain("4MWDGZ4MWSE5J");

    const replayRes = await invokeHandler(handler, "GET", "/api/replay");
    expect(replayRes.statusCode).toBe(200);
    const replayJson = JSON.parse(replayRes.body) as {
      agGridRows: unknown[];
      bryntumTimeline: unknown[];
      statementReceiptPayload: { totalBilledFormatted: string; totalCapturedPayableFormatted: string };
    };
    expect(replayJson.agGridRows).toHaveLength(3);
    expect(replayJson.bryntumTimeline).toHaveLength(4);
    expect(replayJson.statementReceiptPayload.totalBilledFormatted).toBe("$4530.24");
    expect(replayJson.statementReceiptPayload.totalCapturedPayableFormatted).toBe("$4334.22");
  });

  it("handles MCP JSON-RPC 2.0 requests via POST /api/mcp with string bigint normalization", async () => {
    const handler = createClearinghouseRequestHandler();

    const mcpAuthRes = await invokeHandler(handler, "POST", "/api/mcp", {
      jsonrpc: "2.0",
      id: "rpc-1",
      method: "tools/call",
      params: {
        name: "request_work_authorization",
        arguments: {
          requestId: "req_srv_1",
          taskId: "tsk_srv_1",
          orgId: "org_northwind_enterprise",
          agentId: "agt_fin_support_01",
          vendor: "fin",
          taskType: "support_resolution",
          operation: "resolve_conversation",
          requestedMicro: "990000",
          cumulativePeriodMicro: "100000000",
        },
      },
    });
    expect(mcpAuthRes.statusCode).toBe(200);
    const parsedAuth = JSON.parse(mcpAuthRes.body) as {
      result: { outcome: string; authorizedHoldMicro: string; authorizationTokenHash: string };
    };
    expect(parsedAuth.result.outcome).toBe("allow");
    expect(parsedAuth.result.authorizedHoldMicro).toBe("990000");

    const mcpSettleRes = await invokeHandler(handler, "POST", "/api/mcp", {
      jsonrpc: "2.0",
      id: "rpc-2",
      method: "tools/call",
      params: {
        name: "settle_cleared_work",
        arguments: {
          orderId: "ORD-TEST-1",
          authorizationId: "AUTH-TEST-1",
        },
      },
    });
    expect(mcpSettleRes.statusCode).toBe(200);
    const parsedSettle = JSON.parse(mcpSettleRes.body) as {
      result: { splitCapturePlan: { capturePayableMicro: string } };
    };
    expect(parsedSettle.result.splitCapturePlan.capturePayableMicro).toBe("4334220000");
  });

  it("executes POST /api/paypal/authorize and CLI demo in both deterministic and live PayPal Sandbox modes", async () => {
    const detHandler = createClearinghouseRequestHandler({ paypalClientId: "", paypalClientSecret: "" });
    const detRes = await invokeHandler(detHandler, "POST", "/api/paypal/authorize", {});
    expect(detRes.statusCode).toBe(200);
    const detBody = JSON.parse(detRes.body) as { mode: string; order: { id: string } };
    expect(detBody.mode).toBe("DETERMINISTIC_REPLAY");
    expect(detBody.order.id).toBe("PAYPAL-ORDER-8841920X");

    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/v1/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "tok_sandbox_1", expires_in: 3600 }), { status: 200 });
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
      fetchFn: mockFetch,
    });
    const liveRes = await invokeHandler(liveHandler, "POST", "/api/paypal/authorize", {});
    expect(liveRes.statusCode).toBe(200);
    const liveBody = JSON.parse(liveRes.body) as {
      mode: string;
      payeeMerchantId: string;
      order: { id: string; status: string };
      replay: { statementReceiptPayload: { payPalOrderId: string } };
    };
    expect(liveBody.mode).toBe("LIVE_PAYPAL_SANDBOX");
    expect(liveBody.payeeMerchantId).toBe("4MWDGZ4MWSE5J");
    expect(liveBody.order.id).toBe("9XJ11223344556677");
    expect(liveBody.replay.statementReceiptPayload.payPalOrderId).toBe("9XJ11223344556677");

    const cliLive = await runClearinghouseCliDemo({
      paypalClientId: "test_client",
      paypalClientSecret: "test_secret",
      fetchFn: mockFetch,
    });
    expect(cliLive.mode).toBe("LIVE_PAYPAL_SANDBOX");
    expect(cliLive.liveOrder?.id).toBe("9XJ11223344556677");
    expect(cliLive.summary.capturedPayable).toBe("$4334.22");
  });
});
