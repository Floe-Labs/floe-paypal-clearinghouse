import { runClearinghouseDemoReplay } from "./workbench-engine.js";

function serializeBigIntJson(value: unknown): string {
  return JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
}

export function renderClearinghouseWorkbenchHtml(liveCredentialsConfigured: boolean): string {
  const initialReplay = runClearinghouseDemoReplay();
  const initialDataJson = serializeBigIntJson(initialReplay);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Floe PayPal AI Clearinghouse — Verification-Gated Agentic Escrow</title>
  <script src="https://cdn.jsdelivr.net/npm/ag-grid-community@33.1.1/dist/ag-grid-community.min.js"></script>
  <style>
    :root { --bg:#090d16; --panel:#111827; --border:#1f2937; --text:#f9fafb; --muted:#9ca3af; --accent:#3b82f6; --emerald:#10b981; --amber:#f59e0b; --rose:#f43f5e; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; }
    .container { max-width: 1360px; margin: 0 auto; padding: 24px; }
    header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 20px; border-bottom: 1px solid var(--border); margin-bottom: 24px; }
    h1 { margin: 0 0 6px 0; font-size: 24px; font-weight: 700; letter-spacing: -0.02em; }
    h2 { margin: 0 0 12px 0; font-size: 16px; font-weight: 600; color: #e5e7eb; }
    .subtitle { color: var(--muted); font-size: 14px; margin: 0; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: #1e293b; border: 1px solid #334155; }
    .badge.live { background: rgba(16, 185, 129, 0.15); color: #34d399; border-color: rgba(16, 185, 129, 0.4); }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
    .kpi-card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
    .kpi-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
    .kpi-value { font-size: 26px; font-weight: 700; margin: 6px 0 4px 0; font-variant-numeric: tabular-nums; }
    .kpi-sub { font-size: 12px; color: var(--muted); }
    .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 20px; margin-bottom: 24px; }
    .toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
    input[type="search"] { background: #0b1120; border: 1px solid #334155; color: var(--text); padding: 8px 12px; border-radius: 6px; font-size: 13px; min-width: 260px; }
    button { background: var(--accent); color: white; border: none; padding: 8px 14px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; }
    button.secondary { background: #1f2937; border: 1px solid #374151; color: #e5e7eb; }
    button.emerald { background: #059669; }
    button:hover { opacity: 0.92; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .timeline-list { display: flex; flex-direction: column; gap: 10px; }
    .milestone { background: #0b1120; border: 1px solid var(--border); border-left: 4px solid var(--accent); border-radius: 6px; padding: 12px 14px; }
    .milestone-head { display: flex; justify-content: space-between; font-size: 13px; font-weight: 600; }
    .milestone-hash { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--muted); margin-top: 4px; word-break: break-all; }
    pre { background: #070a12; border: 1px solid var(--border); border-radius: 8px; padding: 12px; font-size: 12px; overflow-x: auto; max-height: 290px; color: #d1d5db; margin: 10px 0 0 0; }
    .pill-capture { color: #34d399; font-weight: 700; }
    .pill-void { color: #fbbf24; font-weight: 700; }
    .pill-dispute { color: #fb7185; font-weight: 700; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>Floe PayPal AI Clearinghouse</h1>
        <p class="subtitle">Verification-Gated Escrow, MCP Pre-Execution Authority &amp; Split Settlement on PayPal Orders v2, Payouts &amp; Disputes APIs</p>
      </div>
      <div style="display:flex; gap:10px; align-items:center;">
        <span class="badge">Merchant: 4MWDGZ4MWSE5J</span>
        <span class="badge ${liveCredentialsConfigured ? "live" : ""}">
          ${liveCredentialsConfigured ? "● PayPal Sandbox API Connected" : "● Deterministic Replay Mode"}
        </span>
      </div>
    </header>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">1. PayPal Order v2 AUTHORIZE Hold</div>
        <div class="kpi-value" id="kpi-billed">$4530.24</div>
        <div class="kpi-sub">4,576 billed resolutions @ $0.99 (4,530,240,000 micro-USD)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">2. Verified Cleared Work (CAPTURE)</div>
        <div class="kpi-value" style="color:var(--emerald);" id="kpi-captured">$4334.22</div>
        <div class="kpi-sub">4,378 verified autonomous resolutions settled to Fin AI</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">3. T5 Excluded Reopens (VOID Release)</div>
        <div class="kpi-value" style="color:var(--amber);" id="kpi-voided">$141.57</div>
        <div class="kpi-sub">143 conversations reopened within 5-day contract window</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">4. T6 Contested Handoffs (DISPUTE Hold)</div>
        <div class="kpi-value" style="color:var(--rose);" id="kpi-held">$54.45</div>
        <div class="kpi-sub">55 human-assisted conversations + PROOF_OF_FULFILLMENT pack</div>
      </div>
    </div>

    <div class="panel">
      <div class="toolbar">
        <div>
          <h2>Cleared Work Statement Reconciliation Grid (AG Grid Community v33)</h2>
          <div class="subtitle">Statement <code>CWS-2026-10-FIN-0042</code> (v2) · Buyer: Northwind Global Operations, Inc. · Vendor: Fin AI</div>
        </div>
        <div style="display:flex; gap:8px;">
          <input type="search" id="quick-filter" placeholder="Filter lines, T-Class (T5/T6), reason codes..." />
          <button class="secondary" id="btn-export-csv">Export Statement CSV</button>
          <button class="emerald" id="btn-run-paypal">Execute PayPal Orders v2 AUTHORIZE + Split Plan</button>
        </div>
      </div>
      <div id="statement-grid" style="height: 250px; width: 100%;"></div>
    </div>

    <div class="two-col">
      <div class="panel">
        <h2>M2 → M0 → M1 → M3 Escrow &amp; Audit Timeline (Bryntum Milestone Model)</h2>
        <div class="timeline-list" id="timeline-container"></div>
      </div>
      <div class="panel">
        <div class="toolbar" style="margin-bottom:8px;">
          <h2>M2 Agent Authority MCP Server &amp; Live PayPal Sandbox Inspector</h2>
          <div style="display:flex; gap:6px;">
            <button class="secondary" id="btn-mcp-auth">1. MCP Authorize ($0.99)</button>
            <button class="secondary" id="btn-mcp-restricted">2. Restricted Op Gate</button>
            <button class="secondary" id="btn-mcp-settle">3. MCP Settle Statement</button>
          </div>
        </div>
        <div class="subtitle">Inspect live PayPal Orders v2 / Split Capture payloads &amp; MCP JSON-RPC 2.0 responses:</div>
        <pre id="inspector-output"></pre>
      </div>
    </div>
  </div>

  <script>
    const INITIAL_STATE = ${initialDataJson};
    let gridApi = null;

    function renderTimeline(milestones) {
      document.getElementById("timeline-container").innerHTML = milestones.map((m) => \`
        <div class="milestone">
          <div class="milestone-head"><span>\${m.name}</span><span class="badge">\${m.phase} · \${m.status}</span></div>
          <div class="milestone-hash">Window: \${m.startDate} → \${m.endDate} | Hash: \${m.verificationHash}</div>
        </div>\`).join("");
    }

    function initGrid(rows, receipt) {
      gridApi = agGrid.createGrid(document.getElementById("statement-grid"), {
        rowData: rows,
        pinnedBottomRowData: [{
          lineKey: "TOTAL · " + receipt.statementId,
          description: "Conservation check: Billed === Captured + Voided + Held in Dispute",
          tClass: "T1–T7", reasonCode: "integer_micro_conservation",
          billedFormatted: receipt.totalBilledFormatted,
          clearedPayableFormatted: receipt.totalCapturedPayableFormatted,
          excludedVoidFormatted: receipt.totalVoidedExcludedFormatted,
          disputedHoldFormatted: receipt.totalHeldDisputedFormatted,
          payPalSettlementAction: "CAPTURE",
        }],
        defaultColDef: { sortable: true, filter: true, resizable: true, flex: 1 },
        columnDefs: [
          { field: "lineKey", headerName: "Statement Line", minWidth: 220 },
          { field: "description", headerName: "Work Evidence & Contract Rule", minWidth: 280, flex: 2 },
          { field: "tClass", headerName: "Taxonomy", maxWidth: 110 },
          { field: "reasonCode", headerName: "Reason Code", minWidth: 180 },
          { field: "billedFormatted", headerName: "Billed (Hold)", maxWidth: 130 },
          { field: "clearedPayableFormatted", headerName: "Cleared (Capture)", maxWidth: 145 },
          { field: "excludedVoidFormatted", headerName: "Excluded (Void)", maxWidth: 140 },
          { field: "disputedHoldFormatted", headerName: "Disputed (Hold)", maxWidth: 140 },
          {
            field: "payPalSettlementAction", headerName: "PayPal Action", maxWidth: 150,
            cellRenderer: (p) => {
              const cls = p.value === "CAPTURE" ? "pill-capture" : p.value === "VOID_HOLD" ? "pill-void" : "pill-dispute";
              return \`<span class="\${cls}">\${p.value}</span>\`;
            }
          }
        ]
      });
    }

    document.getElementById("quick-filter").addEventListener("input", (e) => gridApi && gridApi.setGridOption("quickFilterText", e.target.value));
    document.getElementById("btn-export-csv").addEventListener("click", () => gridApi && gridApi.exportDataAsCsv({ fileName: "floe-cleared-work-statement-CWS-2026-10-FIN-0042.csv" }));

    async function postJson(url, body) {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return res.json();
    }

    document.getElementById("btn-run-paypal").addEventListener("click", async () => {
      const out = document.getElementById("inspector-output");
      out.textContent = "Executing PayPal Orders v2 AUTHORIZE + Split Capture Plan...";
      const res = await postJson("/api/paypal/authorize", {});
      if (res.replay && res.replay.bryntumTimeline) renderTimeline(res.replay.bryntumTimeline);
      out.textContent = JSON.stringify(res, null, 2);
    });

    document.getElementById("btn-mcp-auth").addEventListener("click", async () => {
      const res = await postJson("/api/mcp", {
        jsonrpc: "2.0", id: "mcp-1", method: "tools/call",
        params: { name: "request_work_authorization", arguments: { requestId: "req_live_fin_4379", taskId: "tsk_fin_4379", orgId: "org_northwind_enterprise", agentId: "agt_fin_support_01", vendor: "fin", taskType: "support_resolution", operation: "resolve_conversation", requestedMicro: "990000", cumulativePeriodMicro: "4334220000" } }
      });
      document.getElementById("inspector-output").textContent = JSON.stringify(res, null, 2);
    });

    document.getElementById("btn-mcp-restricted").addEventListener("click", async () => {
      const res = await postJson("/api/mcp", {
        jsonrpc: "2.0", id: "mcp-2", method: "tools/call",
        params: { name: "request_work_authorization", arguments: { requestId: "req_live_refund_01", taskId: "tsk_refund_01", orgId: "org_northwind_enterprise", agentId: "agt_fin_support_01", vendor: "fin", taskType: "support_resolution", operation: "issue_refund_above_floor", requestedMicro: "2500000", cumulativePeriodMicro: "4334220000" } }
      });
      document.getElementById("inspector-output").textContent = JSON.stringify(res, null, 2);
    });

    document.getElementById("btn-mcp-settle").addEventListener("click", async () => {
      const res = await postJson("/api/mcp", {
        jsonrpc: "2.0", id: "mcp-3", method: "tools/call",
        params: { name: "settle_cleared_work", arguments: { orderId: "PAYPAL-ORDER-8841920X", authorizationId: "PAYPAL-AUTH-3391042A" } }
      });
      document.getElementById("inspector-output").textContent = JSON.stringify(res, null, 2);
    });

    initGrid(INITIAL_STATE.agGridRows, INITIAL_STATE.statementReceiptPayload);
    renderTimeline(INITIAL_STATE.bryntumTimeline);
    document.getElementById("inspector-output").textContent = JSON.stringify({
      mode: ${liveCredentialsConfigured ? '"LIVE_PAYPAL_SANDBOX_READY"' : '"DETERMINISTIC_REPLAY"'},
      orderAuthPayload: INITIAL_STATE.orderAuth,
      splitCapturePlan: INITIAL_STATE.splitPlan,
    }, null, 2);
  </script>
</body>
</html>`;
}
