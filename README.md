# Floe PayPal AI Clearinghouse

**Autonomous AI Work Governance, Verification-Gated Escrow & Split Settlement on PayPal Orders v2, Payouts & Disputes APIs**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

## Why We Built This

Enterprise buyers are shifting from seat-based SaaS to outcome- and usage-billed AI agents (customer support resolutions, autonomous PR remediation, AI code review). Yet today's payment rails force a broken choice:
1. **Blindly auto-pay vendor invoices**, absorbing 5–18% in invalid charges (reopened tickets within the contract window, human-assisted conversations billed as autonomous, unverified vendor claims), or
2. **Freeze AI agent deployment** behind manual month-end spreadsheet audits.

**Floe PayPal AI Clearinghouse** turns **PayPal Orders v2 (`intent: "AUTHORIZE"`)**, **PayPal Payouts**, and **PayPal Disputes** into an independent, verification-gated financial clearinghouse for autonomous AI work:

```text
Work Requested -> M2 Authority & PayPal AUTHORIZE Hold -> Work Performed -> M0 Buyer Evidence Adjudication -> M1 Cleared Work Statement -> M3 PayPal Split CAPTURE + VOID/Dispute
```

---

## Architecture & Open-Source Packages

1. **`packages/paypal-settlement-provider`** (`@floe-labs/paypal-settlement-provider`)
   - **Pre-Execution Escrow Hold (`buildPayPalOrderAuthorization`)**: Places a deterministic, idempotent `intent: "AUTHORIZE"` hold via PayPal Orders v2 (`POST /v2/checkout/orders`) pinned to the engagement, payee merchant (`4MWDGZ4MWSE5J`), and statement hash (`PayPal-Request-Id`).
   - **Verification-Gated Split Capture (`buildPayPalSplitCapturePlan`)**: Enforces strict conservation of integer micro-units (`1/1,000,000` currency unit, `bigint` only, zero floating-point drift):
     - **Verified Cleared Work** → `POST /v2/payments/authorizations/{id}/capture` (`CAPTURE`)
     - **Confirmed Contract Exclusions (`T2–T7`)** → Released (`VOID_HOLD` / uncaptured remainder)
     - **Contested / Unverified Claims** → Held with `final_capture: false` + automated **PayPal Disputes API Evidence Pack** (`PROOF_OF_FULFILLMENT`) citing exact Cleared Work Taxonomy (`T1–T7`) reason codes and cryptographic evidence hashes (while enforcing that buyer-only `T1` rules are never leaked to vendors).
   - **Multi-Vendor Batch Disbursement (`buildMultiVendorPayoutBatch`)**: Settles approved payable obligations across multiple AI vendors via PayPal Payouts API (`POST /v1/payments/payouts`).
   - **Live PayPal Sandbox / Production Client (`PayPalClearinghouseClient`)**: OAuth2 `client_credentials` token caching, `AbortSignal.timeout` protection, live `Orders v2 AUTHORIZE`, split `Authorizations CAPTURE`, `Payouts`, and dual-mode webhook signature verification (`RSA-SHA256` + `POST /v1/notifications/verify-webhook-signature` across `api.paypal.com` and `api-m.paypal.com` hosts).

2. **`packages/agent-authority-mcp`** (`@floe-labs/agent-authority-mcp`)
   - Model Context Protocol (MCP) JSON-RPC 2.0 server and tools for autonomous agents (`request_work_authorization`, `report_work_evidence`, `settle_cleared_work`).
   - Enforces attenuation ceilings, per-task and per-period spend caps, cryptographically verified HMAC human-in-the-loop sign-off for restricted operations (`createHumanApprovalProof`), and strict separation of **work performed ≠ work billed ≠ work verified ≠ work accepted ≠ work payable**.

3. **`apps/clearinghouse-workbench`**
   - **Interactive Web Workbench (`npm start` → `http://127.0.0.1:4173`)**:
     - **AG Grid Community (`v33`)**: Interactive line-by-line Cleared Work Statement vs. PayPal `CAPTURE` / `VOID_HOLD` / `DISPUTE_HOLD` reconciliation grid with pinned conservation totals, quick-filter search, and 1-click CSV export.
     - **M2 → M0 → M1 → M3 Milestone List (`BryntumTimelineMilestone` Schema)**: End-to-end M2 Authority → M0 Verification → M1 Agreement → M3 PayPal Settlement audit milestone records with SHA-256 verification hashes.
     - **Live MCP & PayPal Inspector**: Interactive buttons to execute MCP JSON-RPC 2.0 tool calls and PayPal `Orders v2 AUTHORIZE` holds + split-capture projections.
   - **CLI Sandbox Runner (`npm run demo`)**: Runs the complete M2 → M0 → M1 → M3 clearinghouse flow from the terminal (automatically executing against live PayPal Sandbox when `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` are provided, or deterministic offline replay when run without credentials).

---

## Quick Start (Zero External Credentials Required)

```bash
npm ci
npm run build
npm run typecheck
npm test
npm run demo
```

### Launch the Interactive Web Workbench (AG Grid + Timeline + MCP Playground)

```bash
npm start
# Opens http://localhost:4173
```

### Run Against Live PayPal Sandbox (`api-m.sandbox.paypal.com`)

Copy `.env.example` to `.env` and provide your PayPal Sandbox credentials (configured for AI Seller Merchant ID `4MWDGZ4MWSE5J`):

```bash
export PAYPAL_CLIENT_ID="your_sandbox_client_id"
export PAYPAL_CLIENT_SECRET="your_sandbox_client_secret"
export PAYPAL_ENVIRONMENT="sandbox"

npm run demo
# Or launch the web UI in Live PayPal Sandbox mode:
npm start
```

### Example: Northwind Global Operations vs. Fin AI Settlement (`CWS-2026-10-FIN-0042`)

| Partition | Conversations | Rate | Micro-USD (`bigint`) | USD | PayPal Action |
| :--- | ---: | ---: | ---: | ---: | :--- |
| **Vendor Invoice Billed** | `4,576` | `$0.99` | `4,530,240,000` | **`$4,530.24`** | `Orders v2 AUTHORIZE` Hold |
| **L1: Verified Autonomous Resolutions** | `4,378` | `$0.99` | `4,334,220,000` | **`$4,334.22`** | `CAPTURE` (`final_capture: false`) |
| **L2: Reopened Within 5-Day Window (`T5`)** | `143` | `$0.99` | `141,570,000` | **`$141.57`** | `VOID_HOLD` (Uncaptured Release) |
| **L3: Human Teammate Intervened (`T6`)** | `55` | `$0.99` | `54,450,000` | **`$54.45`** | `DISPUTE_HOLD` + `PROOF_OF_FULFILLMENT` Pack |
