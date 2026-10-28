import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import {
  handleMcpJsonRpcRequest,
  type AgentAuthorityBudgetPolicy,
  type IssuedWorkAuthorization,
  type McpJsonRpcRequest,
} from "../../../packages/agent-authority-mcp/src/index.js";
import {
  PayPalClearinghouseClient,
  type ClearedStatementLine,
  type ClearedWorkStatementInput,
} from "../../../packages/paypal-settlement-provider/src/index.js";
import { renderClearinghouseWorkbenchHtml } from "./ui-html.js";
import { DEMO_CLEARED_WORK_STATEMENT, runClearinghouseDemoReplay } from "./workbench-engine.js";

function buildServerPolicy(approvalSecret?: string): AgentAuthorityBudgetPolicy {
  const trimmedSecret = (approvalSecret ?? "").trim();
  return {
    orgId: "org_northwind_enterprise",
    agentId: "agt_fin_support_01",
    allowedVendors: ["fin", "zendesk", "coderabbit", "github_copilot"],
    allowedTaskTypes: ["support_resolution", "code_review"],
    maxTaskMicro: 5_000_000n,
    maxPeriodMicro: 10_000_000_000n,
    restrictedOpsRequireApproval: ["issue_refund_above_floor"],
    authorizedApprovers: trimmedSecret ? ["controller_alice"] : [],
    ...(trimmedSecret ? { approvalSecret: trimmedSecret } : {}),
  };
}

function toJsonString(value: unknown): string {
  return JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(toJsonString(payload));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    totalBytes += buf.length;
    if (totalBytes > 256 * 1024) throw new Error("Request body exceeds 256 KiB limit.");
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export function parseMicroBigInt(value: unknown, fieldName: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return BigInt(value.trim());
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  throw new Error(`${fieldName} must be an integer string or safe integer.`);
}

function normalizeStatementInput(rawStmt: unknown): ClearedWorkStatementInput {
  if (typeof rawStmt !== "object" || rawStmt === null || Array.isArray(rawStmt)) {
    throw new Error("statement must be an object.");
  }
  const stmt = rawStmt as Record<string, unknown>;
  if (!Array.isArray(stmt.lines)) throw new Error("statement.lines must be an array.");
  const lines: ClearedStatementLine[] = stmt.lines.map((rawLine, idx) => {
    if (typeof rawLine !== "object" || rawLine === null) {
      throw new Error(`statement.lines[${idx}] must be an object.`);
    }
    const line = rawLine as Record<string, unknown>;
    return {
      ...(line as unknown as ClearedStatementLine),
      billedMicro: parseMicroBigInt(line.billedMicro, `statement.lines[${idx}].billedMicro`),
      clearedPayableMicro: parseMicroBigInt(line.clearedPayableMicro, `statement.lines[${idx}].clearedPayableMicro`),
      excludedCreditMicro: parseMicroBigInt(line.excludedCreditMicro, `statement.lines[${idx}].excludedCreditMicro`),
      heldInDisputeMicro: parseMicroBigInt(line.heldInDisputeMicro, `statement.lines[${idx}].heldInDisputeMicro`),
    };
  });
  return { ...(stmt as unknown as ClearedWorkStatementInput), lines };
}

function computeRecordedPeriodMicro(
  store: ReadonlyMap<string, IssuedWorkAuthorization>,
  orgId: string,
  agentId: string,
): bigint {
  let total = 0n;
  for (const entry of store.values()) {
    if (entry.outcome === "allow" && entry.orgId === orgId && entry.agentId === agentId) {
      total += entry.authorizedHoldMicro;
    }
  }
  return total;
}

function normalizeMcpArguments(
  rawArgs: Record<string, unknown>,
  toolName: string | undefined,
  store: ReadonlyMap<string, IssuedWorkAuthorization>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...rawArgs };
  for (const key of ["requestedMicro", "cumulativePeriodMicro", "vendorBilledMicro"] as const) {
    if (next[key] !== undefined) next[key] = parseMicroBigInt(next[key], key);
  }
  if (toolName === "request_work_authorization") {
    const orgId = typeof next.orgId === "string" ? next.orgId : "";
    const agentId = typeof next.agentId === "string" ? next.agentId : "";
    next.cumulativePeriodMicro = computeRecordedPeriodMicro(store, orgId, agentId);
  }
  if (toolName === "settle_cleared_work" || toolName === "settle_cleared_statement") {
    next.statement =
      next.statement !== undefined ? normalizeStatementInput(next.statement) : DEMO_CLEARED_WORK_STATEMENT;
  }
  return next;
}

export interface WorkbenchServerOptions {
  readonly paypalClientId?: string;
  readonly paypalClientSecret?: string;
  readonly paypalEnvironment?: "sandbox" | "live";
  readonly approvalSecret?: string;
  readonly fetchFn?: typeof fetch;
}

export function createClearinghouseRequestHandler(options?: WorkbenchServerOptions) {
  const store = new Map<string, IssuedWorkAuthorization>();
  const clientId = (options?.paypalClientId ?? process.env.PAYPAL_CLIENT_ID ?? "").trim();
  const clientSecret = (options?.paypalClientSecret ?? process.env.PAYPAL_CLIENT_SECRET ?? "").trim();
  const environment =
    options?.paypalEnvironment ?? (process.env.PAYPAL_ENVIRONMENT === "live" ? "live" : "sandbox");
  const approvalSecret = (options?.approvalSecret ?? process.env.FLOE_APPROVAL_SECRET ?? "").trim();
  const policy = buildServerPolicy(approvalSecret);
  const liveConfigured = Boolean(clientId && clientSecret);

  const paypalClient = liveConfigured
    ? new PayPalClearinghouseClient({ clientId, clientSecret, environment, fetchFn: options?.fetchFn })
    : null;

  return async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://localhost");

    try {
      if (method === "GET" && url.pathname === "/") {
        const html = renderClearinghouseWorkbenchHtml({ liveCredentialsConfigured: liveConfigured, environment });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      if (method === "GET" && url.pathname === "/api/replay") {
        sendJson(res, 200, runClearinghouseDemoReplay());
        return;
      }

      if (method === "POST" && url.pathname === "/api/mcp") {
        const body = await readJsonBody(req);
        const validId = typeof body.id === "string" || typeof body.id === "number";
        const validMethod = typeof body.method === "string" && body.method.trim().length > 0;
        const validParams =
          body.params === undefined ||
          (typeof body.params === "object" && body.params !== null && !Array.isArray(body.params));
        if (body.jsonrpc !== "2.0" || !validId || !validMethod || !validParams) {
          sendJson(res, 400, {
            jsonrpc: "2.0",
            id: validId ? body.id : null,
            error: { code: -32600, message: "Invalid JSON-RPC 2.0 request." },
          });
          return;
        }
        const params = (body.params ?? {}) as Record<string, unknown>;
        const toolName = typeof params.name === "string" ? params.name : undefined;
        const normalizedParams =
          params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
            ? { ...params, arguments: normalizeMcpArguments(params.arguments as Record<string, unknown>, toolName, store) }
            : params;
        const rpcReq: McpJsonRpcRequest = {
          jsonrpc: "2.0",
          id: body.id as string | number,
          method: body.method as McpJsonRpcRequest["method"],
          params: normalizedParams,
        };
        sendJson(res, 200, handleMcpJsonRpcRequest(rpcReq, { policy, store, ...(approvalSecret ? { approvalSecret } : {}) }));
        return;
      }

      if (method === "POST" && url.pathname === "/api/paypal/authorize") {
        const body = await readJsonBody(req);
        const suppliedOrderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
        const suppliedAuthId = typeof body.authorizationId === "string" ? body.authorizationId.trim() : "";

        if (paypalClient) {
          const liveMode = environment === "live" ? "LIVE_PAYPAL_PRODUCTION" : "LIVE_PAYPAL_SANDBOX";
          if (suppliedOrderId || suppliedAuthId) {
            if (!suppliedOrderId || !suppliedAuthId) {
              throw new Error("Both orderId and authorizationId are required to capture a live authorized order.");
            }
            const { capture } = await paypalClient.captureAuthorizedWork(
              DEMO_CLEARED_WORK_STATEMENT,
              suppliedOrderId,
              suppliedAuthId,
            );
            const replay = runClearinghouseDemoReplay(DEMO_CLEARED_WORK_STATEMENT, {
              orderId: suppliedOrderId,
              authorizationId: suppliedAuthId,
            });
            sendJson(res, 200, {
              mode: liveMode,
              settlementStatus: "LIVE_CAPTURE_COMPLETED",
              payeeMerchantId: DEMO_CLEARED_WORK_STATEMENT.payeeMerchantId,
              order: { id: suppliedOrderId, status: "COMPLETED" },
              authorizationId: suppliedAuthId,
              capture,
              replay,
            });
            return;
          }

          const { order } = await paypalClient.createOrderAuthorization(DEMO_CLEARED_WORK_STATEMENT);
          const projectedReplay = runClearinghouseDemoReplay(DEMO_CLEARED_WORK_STATEMENT);
          sendJson(res, 200, {
            mode: liveMode,
            settlementStatus: "ORDER_CREATED_AWAITING_BUYER_APPROVAL",
            payeeMerchantId: DEMO_CLEARED_WORK_STATEMENT.payeeMerchantId,
            order,
            projectedReplay,
          });
          return;
        }

        const replay = runClearinghouseDemoReplay();
        sendJson(res, 200, {
          mode: "DETERMINISTIC_REPLAY",
          settlementStatus: "SIMULATED_REPLAY",
          payeeMerchantId: DEMO_CLEARED_WORK_STATEMENT.payeeMerchantId,
          order: { id: replay.statementReceiptPayload.payPalOrderId, status: "CREATED" },
          replay,
        });
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  };
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function startClearinghouseServer(
  port = Number(process.env.PORT ?? 4173),
  host = process.env.HOST ?? "127.0.0.1",
) {
  if (!LOOPBACK_HOSTS.has(host) && !(process.env.WORKBENCH_API_TOKEN ?? "").trim()) {
    throw new Error("Refusing to bind Clearinghouse Workbench to non-loopback host without WORKBENCH_API_TOKEN.");
  }
  const server = createServer(createClearinghouseRequestHandler());
  server.listen(port, host, () => {
    process.stdout.write(`Floe PayPal AI Clearinghouse Workbench running at http://${host}:${port}\n`);
  });
  return server;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) startClearinghouseServer();
