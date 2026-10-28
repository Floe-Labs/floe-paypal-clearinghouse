import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import {
  handleMcpJsonRpcRequest,
  type AgentAuthorityBudgetPolicy,
  type IssuedWorkAuthorization,
  type McpJsonRpcRequest,
} from "../../../packages/agent-authority-mcp/src/index.js";
import { PayPalClearinghouseClient } from "../../../packages/paypal-settlement-provider/src/index.js";
import { renderClearinghouseWorkbenchHtml } from "./ui-html.js";
import { DEMO_CLEARED_WORK_STATEMENT, runClearinghouseDemoReplay } from "./workbench-engine.js";

const DEFAULT_DEMO_POLICY: AgentAuthorityBudgetPolicy = {
  orgId: "org_northwind_enterprise",
  agentId: "agt_fin_support_01",
  allowedVendors: ["fin", "zendesk", "coderabbit", "github_copilot"],
  allowedTaskTypes: ["support_resolution", "code_review"],
  maxTaskMicro: 5_000_000n,
  maxPeriodMicro: 10_000_000_000n,
  restrictedOpsRequireApproval: ["issue_refund_above_floor"],
  authorizedApprovers: ["controller_alice"],
};

function toJsonString(value: unknown): string {
  return JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    totalBytes += buf.length;
    if (totalBytes > 256 * 1024) {
      throw new Error("Request body exceeds 256 KiB limit.");
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function normalizeMcpArguments(rawArgs: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...rawArgs };
  for (const key of ["requestedMicro", "cumulativePeriodMicro", "vendorBilledMicro"] as const) {
    if (typeof next[key] === "string" || typeof next[key] === "number") {
      next[key] = BigInt(next[key]);
    }
  }
  if (!next.statement) {
    next.statement = DEMO_CLEARED_WORK_STATEMENT;
  }
  return next;
}

export interface WorkbenchServerOptions {
  readonly paypalClientId?: string;
  readonly paypalClientSecret?: string;
  readonly paypalEnvironment?: "sandbox" | "live";
  readonly fetchFn?: typeof fetch;
}

export function createClearinghouseRequestHandler(options?: WorkbenchServerOptions) {
  const store = new Map<string, IssuedWorkAuthorization>();
  const clientId = (options?.paypalClientId ?? process.env.PAYPAL_CLIENT_ID ?? "").trim();
  const clientSecret = (options?.paypalClientSecret ?? process.env.PAYPAL_CLIENT_SECRET ?? "").trim();
  const environment = options?.paypalEnvironment ?? (process.env.PAYPAL_ENVIRONMENT === "live" ? "live" : "sandbox");
  const liveConfigured = Boolean(clientId && clientSecret);

  const paypalClient = liveConfigured
    ? new PayPalClearinghouseClient({
        clientId,
        clientSecret,
        environment,
        fetchFn: options?.fetchFn,
      })
    : null;

  return async function handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://localhost");

    try {
      if (method === "GET" && url.pathname === "/") {
        const html = renderClearinghouseWorkbenchHtml(liveConfigured);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      if (method === "GET" && url.pathname === "/api/replay") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(toJsonString(runClearinghouseDemoReplay()));
        return;
      }

      if (method === "POST" && url.pathname === "/api/mcp") {
        const body = await readJsonBody(req);
        const params = (body.params ?? {}) as Record<string, unknown>;
        const normalizedParams =
          params.arguments && typeof params.arguments === "object"
            ? { ...params, arguments: normalizeMcpArguments(params.arguments as Record<string, unknown>) }
            : params;
        const rpcReq: McpJsonRpcRequest = {
          jsonrpc: "2.0",
          id: (body.id as string | number) ?? 1,
          method: (body.method as McpJsonRpcRequest["method"]) ?? "tools/list",
          params: normalizedParams,
        };
        const rpcResp = handleMcpJsonRpcRequest(rpcReq, { policy: DEFAULT_DEMO_POLICY, store });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(toJsonString(rpcResp));
        return;
      }

      if (method === "POST" && url.pathname === "/api/paypal/authorize") {
        if (paypalClient) {
          const { order } = await paypalClient.createOrderAuthorization(DEMO_CLEARED_WORK_STATEMENT);
          const replay = runClearinghouseDemoReplay(DEMO_CLEARED_WORK_STATEMENT, {
            orderId: order.id,
          });
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(
            toJsonString({
              mode: "LIVE_PAYPAL_SANDBOX",
              payeeMerchantId: DEMO_CLEARED_WORK_STATEMENT.payeeMerchantId,
              order,
              replay,
            }),
          );
          return;
        }

        const replay = runClearinghouseDemoReplay();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(
          toJsonString({
            mode: "DETERMINISTIC_REPLAY",
            payeeMerchantId: DEMO_CLEARED_WORK_STATEMENT.payeeMerchantId,
            order: {
              id: replay.statementReceiptPayload.payPalOrderId,
              status: "CREATED",
            },
            replay,
          }),
        );
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Not found" }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  };
}

export function startClearinghouseServer(port = Number(process.env.PORT ?? 4173)) {
  const server = createServer(createClearinghouseRequestHandler());
  server.listen(port, () => {
    process.stdout.write(
      `Floe PayPal AI Clearinghouse Workbench running at http://localhost:${port}\n`,
    );
  });
  return server;
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  startClearinghouseServer();
}
