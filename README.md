# Floe PayPal AI Clearinghouse

**Autonomous AI Work Governance, Verification-Gated Escrow & Split Settlement on PayPal Orders v2, Payouts & Disputes APIs**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

## Why We Built This

Enterprise buyers are shifting from seat-based SaaS to outcome- and usage-billed AI agents (customer support resolutions, autonomous PR remediation, AI code review). Yet today's payment rails force a broken choice:
1. **Blindly auto-pay vendor invoices**, absorbing 5–18% in invalid charges (reopened tickets within the contract window, human-assisted conversations billed as autonomous, unverified vendor claims), or
2. **Freeze AI agent deployment** behind manual month-end spreadsheet audits.

**Floe PayPal AI Clearinghouse** solves this by turning **PayPal Orders v2 (`intent: "AUTHORIZE"`)**, **PayPal Payouts**, and **PayPal Disputes** into a **verification-gated financial clearinghouse for autonomous AI work**:

```
Work Requested -> M2 Authority & PayPal AUTHORIZE Hold -> Work Performed -> M0 Buyer Evidence Adjudication -> M1 Cleared Work Statement -> M3 PayPal Split CAPTURE + VOID/Dispute
```

---

## Architecture & Open-Source Packages

1. **`packages/paypal-settlement-provider`** (`@floe-labs/paypal-settlement-provider`)
   - **Pre-Execution Escrow Hold (`buildPayPalOrderAuthorization`)**: Places a deterministic, idempotent `intent: "AUTHORIZE"` hold via PayPal Orders v2 pinned to the engagement and statement hash.
   - **Verification-Gated Split Capture (`buildPayPalSplitCapturePlan`)**: Enforces conservation of integer micro-units (`1/1,000,000` currency unit, `bigint` only, zero floating-point drift):
     - **Verified Cleared Work** → `POST /v2/payments/authorizations/{id}/capture` (`CAPTURE`)
     - **Confirmed Contract Exclusions (T2–T7)** → Released (`VOID` / uncaptured remainder)
     - **Contested / Unverified Claims** → Held with `final_capture: false` + automated **PayPal Disputes API Evidence Pack** (`PROOF_OF_FULFILLMENT`) citing exact Cleared Work Taxonomy (`T1–T7`) reason codes and cryptographic evidence hashes.
   - **Multi-Vendor Batch Disbursement (`buildMultiVendorPayoutBatch`)**: Settles approved payable obligations across multiple AI vendors via PayPal Payouts API.
   - **Idempotent Webhook Verification (`verifyAndDeduplicatePayPalWebhook`)**: Verifies HMAC signatures and deduplicates replayed PayPal webhook deliveries.

2. **`packages/agent-authority-mcp`** (`@floe-labs/agent-authority-mcp`)
   - Model Context Protocol (MCP) JSON-RPC 2.0 server and tools for autonomous agents (`request_work_authorization`, `report_work_evidence`, `settle_cleared_work`).
   - Enforces attenuation ceilings, per-task and per-period spend caps, cryptographically verified human-in-the-loop sign-off for restricted operations, and strict separation of **work performed ≠ work billed ≠ work verified ≠ work accepted ≠ work payable**.

3. **`apps/clearinghouse-workbench`**
   - Deterministic Sandbox Replay (`runClearinghouseDemoReplay`) + interactive data payloads for:
     - **AG Grid**: Line-by-line Cleared Work Statement vs. PayPal `CAPTURE` / `VOID_HOLD` / `DISPUTE_HOLD` reconciliation grid.
     - **Bryntum Timeline**: End-to-end M2 Authority → M0 Verification → M1 Agreement → M3 PayPal Settlement audit timeline.
     - **Foxit PDF Document Generation**: Cryptographically watermarked Cleared Work Statement & PayPal Settlement Receipt.

---

## Quick Start (Zero External Credentials Required)

```bash
npm ci
npm run build
npm run typecheck
npm test
```

### Example: Deterministic Northwind vs. Fin AI Settlement Replay

- **Vendor Invoice Billed (`AUTHORIZE` Hold)**: `$4,530.24` (`4,530,240,000` micro-USD)
- **Verified Cleared Work (`CAPTURE` to Vendor)**: `$4,334.22` (`4,378` verified autonomous resolutions @ `$0.99`)
- **Excluded Reopens within 5-Day Window (`T5` · `VOID_HOLD`)**: `$141.57` (`143` conversations returned to buyer)
- **Contested Human Handoffs (`T6` · `DISPUTE_HOLD` + PayPal Dispute Evidence Pack)**: `$54.45` (`55` conversations)
