import { runClearinghouseDemoReplay } from "./workbench-engine.js";

function serializeBigIntJson(value: unknown): string {
  return JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
}

export interface WorkbenchUiRenderOptions {
  readonly liveCredentialsConfigured: boolean;
  readonly environment?: "sandbox" | "live";
}

export function renderClearinghouseWorkbenchHtml(
  options: boolean | WorkbenchUiRenderOptions = false,
): string {
  const liveCredentialsConfigured =
    typeof options === "boolean" ? options : options.liveCredentialsConfigured;
  const environment =
    typeof options === "boolean" ? "sandbox" : (options.environment ?? "sandbox");

  const badgeText = !liveCredentialsConfigured
    ? "● Deterministic Replay Mode"
    : environment === "live"
      ? "● PayPal Production API Connected"
      : "● PayPal Sandbox API Connected";

  const initialMode = !liveCredentialsConfigured
    ? "DETERMINISTIC_REPLAY"
    : environment === "live"
      ? "LIVE_PAYPAL_PRODUCTION_READY"
      : "LIVE_PAYPAL_SANDBOX_READY";

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
    input[type="search"], select { background: #0b1120; border: 1px solid #334155; color: var(--text); padding: 8px 12px; border-radius: 6px; font-size: 13px; }
    input[type="search"] { min-width: 240px; }
    .eval-strip { display: grid; grid-template-columns: 1.2fr 2fr; gap: 14px; background: #0b1120; border: 1px solid #1e293b; border-radius: 10px; padding: 14px 18px; margin-bottom: 24px; font-size: 12px; }
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
      <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
        <select id="preset-selector" aria-label="Vendor Statement Preset">
          <option value="fin">Preset 1: Fin AI — CX Outcome Billing ($4,530.24)</option>
          <option value="vapi">Preset 2: Vapi Voice AI — Wave 2 Telemetry ($1,900.00)</option>
          <option value="autonomous_eng">Preset 3: Cursor + Copilot + CodeRabbit ($3,160.00)</option>
        </select>
        <span class="badge" id="merchant-badge">17 Locked Vendors · Merchant: 4MWDGZ4MWSE5J</span>
        <span class="badge ${liveCredentialsConfigured ? "live" : ""}">${badgeText}</span>
      </div>
    </header>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">1. PayPal Order v2 AUTHORIZE Hold</div>
        <div class="kpi-value" id="kpi-billed">$4530.24</div>
        <div class="kpi-sub" id="kpi-sub-billed">4,576 billed resolutions @ $0.99 (4,530,240,000 micro-USD)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">2. Verified Cleared Work (CAPTURE)</div>
        <div class="kpi-value" style="color:var(--emerald);" id="kpi-captured">$4334.22</div>
        <div class="kpi-sub" id="kpi-sub-captured">4,378 verified autonomous resolutions settled to Fin AI</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">3. Excluded Failures (VOID Release)</div>
        <div class="kpi-value" style="color:var(--amber);" id="kpi-voided">$141.57</div>
        <div class="kpi-sub" id="kpi-sub-voided">143 conversations reopened within 5-day contract window</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">4. Contested Claims (DISPUTE Hold)</div>
        <div class="kpi-value" style="color:var(--rose);" id="kpi-held">$54.45</div>
        <div class="kpi-sub" id="kpi-sub-held">55 human-assisted conversations + PROOF_OF_FULFILLMENT pack</div>
      </div>
    </div>

    <div class="eval-strip">
      <div>
        <div style="font-weight:700; color:#e5e7eb; margin-bottom:4px;">Effective Cost per Cleared Outcome &amp; Scope Attribution</div>
        <div id="econ-summary" style="color:var(--muted);"></div>
        <div id="econ-scope" style="font-family:ui-monospace,monospace; color:#60a5fa; margin-top:4px;"></div>
      </div>
      <div>
        <div style="font-weight:700; color:#e5e7eb; margin-bottom:4px;">3-Tier Eval-as-SOR Waterfall ([a] Buyer Eval → [b] Vendor Eval → [c] Floe Deterministic)</div>
        <div id="eval-waterfall" style="color:var(--muted); display:flex; flex-direction:column; gap:2px;"></div>
      </div>
    </div>

    <div class="panel">
      <div class="toolbar">
        <div>
          <h2>Cleared Work Statement Reconciliation Grid (AG Grid Community v33)</h2>
          <div class="subtitle" id="stmt-subtitle">Statement <code>CWS-2026-10-FIN-0042</code> (v2) · Buyer: Northwind Global Operations, Inc. · Vendor: Fin AI</div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <input type="search" id="quick-filter" placeholder="Filter lines, T-Class (T2/T5/T6), reason codes..." />
          <button class="secondary" id="btn-export-csv">Export Statement CSV</button>
          <button class="emerald" id="btn-run-paypal">Create PayPal Order v2 AUTHORIZE + Preview Split Plan</button>
        </div>
      </div>
      <div id="statement-grid" style="height: 250px; width: 100%;"></div>
    </div>

    <div class="two-col">
      <div class="panel">
        <h2>M2 → M0 → M1 → M3 Escrow &amp; Audit Milestone List (BryntumTimelineMilestone Schema)</h2>
        <div class="timeline-list" id="timeline-container"></div>
      </div>
      <div class="panel">
        <div class="toolbar" style="margin-bottom:8px;">
          <h2>M2 Agent Authority MCP Server &amp; Live PayPal Inspector</h2>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button class="secondary" id="btn-mcp-auth">1. MCP Authorize ($0.99)</button>
            <button class="secondary" id="btn-mcp-restricted">2. Restricted Op Gate</button>
            <button class="secondary" id="btn-mcp-settle">3. MCP Settle Statement</button>
            <button class="secondary" id="btn-multi-payout">4. Multi-Vendor Payout Batch</button>
          </div>
        </div>
        <div class="subtitle">Inspect live PayPal Orders v2 / Split Capture payloads &amp; MCP JSON-RPC 2.0 responses:</div>
        <pre id="inspector-output"></pre>
      </div>
    </div>
  </div>

  <script>
    const INITIAL_STATE = ${initialDataJson};
    let gridApi = null, activePreset = "fin", presetSeq = 0, mcpSeq = 0;
    let activeStatementId = INITIAL_STATE.statementReceiptPayload.statementId;
    let activeMcpFixture = INITIAL_STATE.unitEconomicsAndEval.mcpFixture;
    const ACTION_BTNS = ["btn-run-paypal", "btn-mcp-auth", "btn-mcp-restricted", "btn-mcp-settle", "btn-multi-payout"];
    function setActionsDisabled(disabled) { ACTION_BTNS.forEach((id) => { document.getElementById(id).disabled = disabled; }); }

    function renderTimeline(milestones) {
      document.getElementById("timeline-container").innerHTML = milestones.map((m) => \`
        <div class="milestone">
          <div class="milestone-head"><span>\${m.name}</span><span class="badge">\${m.phase} · \${m.status}</span></div>
          <div class="milestone-hash">Window: \${m.startDate} → \${m.endDate} | Hash: \${m.verificationHash}</div>
        </div>\`).join("");
    }

    function makeTotalRow(r) {
      return [{ lineKey: "TOTAL · " + r.statementId, description: "Conservation check: Billed === Captured + Voided + Held in Dispute", tClass: "T1–T7", reasonCode: "integer_micro_conservation", billedFormatted: r.totalBilledFormatted, clearedPayableFormatted: r.totalCapturedPayableFormatted, excludedVoidFormatted: r.totalVoidedExcludedFormatted, disputedHoldFormatted: r.totalHeldDisputedFormatted, payPalSettlementAction: "CAPTURE" }];
    }

    function applyReplayState(state) {
      const r = state.statementReceiptPayload, e = state.unitEconomicsAndEval;
      activeStatementId = r.statementId;
      document.getElementById("kpi-billed").textContent = r.totalBilledFormatted;
      document.getElementById("kpi-captured").textContent = r.totalCapturedPayableFormatted;
      document.getElementById("kpi-voided").textContent = r.totalVoidedExcludedFormatted;
      document.getElementById("kpi-held").textContent = r.totalHeldDisputedFormatted;
      document.getElementById("stmt-subtitle").innerHTML = \`Statement <code>\${r.statementId}</code> (v\${r.statementVersion}) · Buyer: \${r.buyerName} · Vendor: \${r.vendorName}\`;
      if (e) {
        if (e.kpiSubtitles) {
          document.getElementById("kpi-sub-billed").textContent = e.kpiSubtitles.billed;
          document.getElementById("kpi-sub-captured").textContent = e.kpiSubtitles.captured;
          document.getElementById("kpi-sub-voided").textContent = e.kpiSubtitles.voided;
          document.getElementById("kpi-sub-held").textContent = e.kpiSubtitles.held;
        }
        if (e.payeeMerchantId) document.getElementById("merchant-badge").textContent = "17 Locked Vendors · Merchant: " + e.payeeMerchantId;
        if (e.mcpFixture) { activeMcpFixture = e.mcpFixture; document.getElementById("btn-mcp-auth").textContent = e.mcpFixture.buttonLabel; }
        document.getElementById("econ-summary").textContent = \`Unverified Billed: \${e.unverifiedEffectiveUnitCostFormatted} → Verified Cleared: \${e.verifiedClearedUnitCostFormatted} | Shielded: \${e.leakagePreventedFormatted} (\${e.leakagePercentFormatted})\`;
        document.getElementById("econ-scope").textContent = e.scopeKeyAttribution + " · " + e.pricingModelLabel;
        document.getElementById("eval-waterfall").innerHTML = \`<span>\${e.evalWaterfall.tierA_BuyerEval}</span><span>\${e.evalWaterfall.tierB_VendorEval}</span><span>\${e.evalWaterfall.tierC_FloeDeterministicEval}</span>\`;
      }
      if (gridApi) { gridApi.setGridOption("rowData", state.agGridRows); gridApi.setGridOption("pinnedBottomRowData", makeTotalRow(r)); }
      renderTimeline(state.bryntumTimeline);
    }

    function initGrid(rows, receipt) {
      gridApi = agGrid.createGrid(document.getElementById("statement-grid"), {
        rowData: rows,
        pinnedBottomRowData: makeTotalRow(receipt),
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
            cellRenderer: (p) => \`<span class="\${p.value === "CAPTURE" ? "pill-capture" : p.value === "VOID_HOLD" ? "pill-void" : "pill-dispute"}">\${p.value}</span>\`
          }
        ]
      });
    }

    document.getElementById("quick-filter").addEventListener("input", (e) => gridApi && gridApi.setGridOption("quickFilterText", e.target.value));
    document.getElementById("btn-export-csv").addEventListener("click", () => gridApi && gridApi.exportDataAsCsv({ fileName: "floe-cleared-work-statement-" + activeStatementId + ".csv" }));

    async function postJson(url, body) {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const text = await res.text();
      let parsed;
      try { parsed = text ? JSON.parse(text) : {}; } catch { throw new Error(\`Invalid JSON response (HTTP \${res.status}): \${text.slice(0, 200)}\`); }
      if (!res.ok) throw new Error(parsed && parsed.error ? (typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed.error)) : \`Request failed with HTTP \${res.status}\`);
      return parsed;
    }

    async function runInspectorAction(label, fn) {
      const out = document.getElementById("inspector-output");
      out.textContent = label;
      try {
        const res = await fn();
        const timeline = (res.projectedReplay && res.projectedReplay.bryntumTimeline) || (res.replay && res.replay.bryntumTimeline);
        if (timeline) renderTimeline(timeline);
        out.textContent = JSON.stringify(res, null, 2);
      } catch (err) {
        out.textContent = JSON.stringify({ error: err instanceof Error ? err.message : String(err) }, null, 2);
      }
    }

    document.getElementById("btn-run-paypal").addEventListener("click", () => runInspectorAction("Executing PayPal Orders v2 AUTHORIZE + Split Plan...", () => postJson("/api/paypal/authorize", { preset: activePreset })));
    document.getElementById("preset-selector").addEventListener("change", async (ev) => {
      const selectedPreset = ev.target.value, seq = ++presetSeq, out = document.getElementById("inspector-output");
      setActionsDisabled(true);
      out.textContent = "Loading vendor statement preset " + selectedPreset + "...";
      try {
        const res = await fetch("/api/replay?preset=" + encodeURIComponent(selectedPreset));
        const data = await res.json();
        if (!res.ok) throw new Error(data && data.error ? data.error : "HTTP " + res.status);
        if (seq !== presetSeq) return;
        activePreset = selectedPreset;
        applyReplayState(data);
        out.textContent = JSON.stringify(data, null, 2);
      } catch (err) {
        if (seq === presetSeq) { ev.target.value = activePreset; out.textContent = JSON.stringify({ error: err instanceof Error ? err.message : String(err) }, null, 2); }
      } finally {
        if (seq === presetSeq) setActionsDisabled(false);
      }
    });
    document.getElementById("btn-multi-payout").addEventListener("click", () => runInspectorAction("Building Multi-Vendor PayPal Payouts Batch...", async () => (await fetch("/api/replay?preset=" + encodeURIComponent(activePreset) + "&mode=MULTI_VENDOR_PAYOUT")).json()));
    document.getElementById("btn-mcp-auth").addEventListener("click", () => runInspectorAction("Requesting MCP pre-execution work authorization...", () => postJson("/api/mcp", { jsonrpc: "2.0", id: "mcp-1", method: "tools/call", params: { name: "request_work_authorization", arguments: { requestId: activeMcpFixture.requestId + "_" + (++mcpSeq), taskId: activeMcpFixture.taskId, orgId: "org_northwind_enterprise", agentId: "agt_fin_support_01", vendor: activeMcpFixture.vendor, taskType: activeMcpFixture.taskType, operation: activeMcpFixture.operation, requestedMicro: String(activeMcpFixture.requestedMicro), cumulativePeriodMicro: "0" } } })));
    document.getElementById("btn-mcp-restricted").addEventListener("click", () => runInspectorAction("Checking restricted operation gate...", () => postJson("/api/mcp", { jsonrpc: "2.0", id: "mcp-2", method: "tools/call", params: { name: "request_work_authorization", arguments: { requestId: "req_live_refund_" + activePreset + "_" + (++mcpSeq), taskId: "tsk_refund_" + activePreset, orgId: "org_northwind_enterprise", agentId: "agt_fin_support_01", vendor: activeMcpFixture.vendor, taskType: activeMcpFixture.taskType, operation: "issue_refund_above_floor", requestedMicro: "2500000", cumulativePeriodMicro: "0" } } })));
    document.getElementById("btn-mcp-settle").addEventListener("click", () => runInspectorAction("Running MCP settle_cleared_work...", () => postJson("/api/mcp", { jsonrpc: "2.0", id: "mcp-3", method: "tools/call", params: { name: "settle_cleared_work", arguments: { preset: activePreset, orderId: "PAYPAL-ORDER-8841920X", authorizationId: "PAYPAL-AUTH-3391042A" } } })));

    initGrid(INITIAL_STATE.agGridRows, INITIAL_STATE.statementReceiptPayload);
    applyReplayState(INITIAL_STATE);
    document.getElementById("inspector-output").textContent = JSON.stringify({
      mode: ${JSON.stringify(initialMode)},
      unitEconomicsAndEval: INITIAL_STATE.unitEconomicsAndEval,
      orderAuthPayload: INITIAL_STATE.orderAuth,
      splitCapturePlan: INITIAL_STATE.splitPlan,
    }, null, 2);
  </script>
</body>
</html>`;
}
