import {
  formatMicroToDecimal,
  type ClearedWorkStatementInput,
} from "../../../packages/paypal-settlement-provider/src/index.js";

/**
 * All 17 locked AI vendor contract families from floe-recon (PR #177, Waves 1-3)
 * plus `github_copilot` alias for MCP policy compatibility.
 */
export const LOCKED_17_VENDORS: readonly string[] = [
  "fin", "fin_platforms", "coderabbit", "zendesk", "github", "github_copilot",
  "cursor", "openai", "anthropic", "google", "vapi", "retell",
  "elevenlabs", "deepgram", "bland", "openrouter", "langsmith", "helicone",
];

export const LOCKED_TASK_TYPES: readonly string[] = [
  "support_resolution", "code_review", "voice_call", "agent_task", "llm_inference",
];

export function sanitizePayPalCredential(raw?: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || (trimmed.startsWith("<") && trimmed.endsWith(">")) || trimmed.startsWith("your_")) {
    return "";
  }
  return trimmed;
}

export type DemoPresetKey = "fin" | "vapi" | "autonomous_eng";

export interface PresetMcpDemoFixture {
  readonly requestId: string;
  readonly taskId: string;
  readonly vendor: string;
  readonly taskType: string;
  readonly operation: string;
  readonly requestedMicro: bigint;
  readonly cumulativePeriodMicro: bigint;
  readonly evidenceRef: string;
  readonly buttonLabel: string;
}

export interface EvalWaterfallAndEconomics {
  readonly presetKey: DemoPresetKey;
  readonly payeeMerchantId: string;
  readonly pricingModelLabel: string;
  readonly contractedUnitRateFormatted: string;
  readonly unverifiedEffectiveUnitCostFormatted: string;
  readonly verifiedClearedUnitCostFormatted: string;
  readonly leakagePreventedFormatted: string;
  readonly leakagePercentFormatted: string;
  readonly leakageBasisPoints: number;
  readonly scopeKeyAttribution: string;
  readonly kpiSubtitles: {
    readonly billed: string;
    readonly captured: string;
    readonly voided: string;
    readonly held: string;
  };
  readonly mcpFixture: PresetMcpDemoFixture;
  readonly evalWaterfall: {
    readonly tierA_BuyerEval: string;
    readonly tierB_VendorEval: string;
    readonly tierC_FloeDeterministicEval: string;
  };
}

export const VAPI_VOICE_STATEMENT: ClearedWorkStatementInput = {
  statementId: "CWS-2026-10-VAPI-0018",
  statementVersion: 1,
  statementHash: "sha256:4b8c19e02d71a64f33b8105c9e1204a7d6c55b8a90123456789abcdef0123456",
  orgId: "org_northwind_enterprise",
  buyerName: "Northwind Global Operations, Inc.",
  vendorName: "Vapi Voice AI Platform",
  payeeMerchantId: "7VAP92KLMN34P",
  currency: "USD",
  periodStartIso: "2026-10-01T00:00:00Z",
  periodEndIso: "2026-10-31T00:00:00Z",
  lines: [
    {
      lineKey: "L1_VERIFIED_VOICE_MINUTES",
      description: "Verified connected voice agent minutes (32,400 mins @ $0.05/min)",
      billedMicro: 1_620_000_000n,
      clearedPayableMicro: 1_620_000_000n,
      excludedCreditMicro: 0n,
      heldInDisputeMicro: 0n,
      verified: true,
      contractValid: true,
      buyerAccepted: true,
      evidenceRefs: ["ev:vapi:call_logs_verified_32400m"],
    },
    {
      lineKey: "L2_UNCONNECTED_RING_NO_ANSWER",
      description: "Unconnected / SIP failed calls billed in export (vapi.call.unconnected_or_failed_free)",
      billedMicro: 185_000_000n,
      clearedPayableMicro: 0n,
      excludedCreditMicro: 185_000_000n,
      heldInDisputeMicro: 0n,
      tClass: "T5",
      reasonCode: "unconnected_or_failed_call",
      evidenceRefs: ["ev:vapi:sip_480_486_batch"],
    },
    {
      lineKey: "L3_BYOK_LLM_VOICE_PASS_THROUGH",
      description: "BYOK Deepgram/ElevenLabs pass-through rebilled above 0% markup (vapi.call.byok_provider_not_rebilled)",
      billedMicro: 95_000_000n,
      clearedPayableMicro: 0n,
      excludedCreditMicro: 0n,
      heldInDisputeMicro: 95_000_000n,
      tClass: "T2",
      reasonCode: "byok_provider_rebilled",
      evidenceRefs: ["ev:vapi:byok_key_overlap_19"],
    },
  ],
};

export const AUTONOMOUS_ENG_STATEMENT: ClearedWorkStatementInput = {
  statementId: "CWS-2026-10-ENG-0091",
  statementVersion: 1,
  statementHash: "sha256:7d3a91c45e80b21f66c4901a8b3402e9f1a77c6d890123456789abcdef654321",
  orgId: "org_northwind_enterprise",
  buyerName: "Northwind Global Operations, Inc.",
  vendorName: "Cursor + Copilot + CodeRabbit AI Bundle",
  payeeMerchantId: "9ENG84QRST56W",
  currency: "USD",
  periodStartIso: "2026-10-01T00:00:00Z",
  periodEndIso: "2026-10-31T00:00:00Z",
  lines: [
    {
      lineKey: "L1_VERIFIED_AGENT_PR_AND_SEATS",
      description: "Verified active seats & merged agent PR tasks (Copilot nano-credit v2 + CodeRabbit)",
      billedMicro: 2_840_000_000n,
      clearedPayableMicro: 2_840_000_000n,
      excludedCreditMicro: 0n,
      heldInDisputeMicro: 0n,
      verified: true,
      contractValid: true,
      buyerAccepted: true,
      evidenceRefs: ["ev:github:copilot_v2_merged_prs", "ev:coderabbit:pr_reviews_verified"],
    },
    {
      lineKey: "L2_CURSOR_ABORTED_ERRORED_REQUESTS",
      description: "Errored / aborted fast-request completions (cursor.usage.errored_or_aborted_free)",
      billedMicro: 210_000_000n,
      clearedPayableMicro: 0n,
      excludedCreditMicro: 210_000_000n,
      heldInDisputeMicro: 0n,
      tClass: "T5",
      reasonCode: "errored_or_aborted_completion",
      evidenceRefs: ["ev:cursor:http_5xx_aborted_420"],
    },
    {
      lineKey: "L3_CROSS_VENDOR_DUPLICATE_PR_REVIEW",
      description: "Copilot + CodeRabbit duplicate review on abandoned draft PRs (Copilot Fusion)",
      billedMicro: 110_000_000n,
      clearedPayableMicro: 0n,
      excludedCreditMicro: 0n,
      heldInDisputeMicro: 110_000_000n,
      tClass: "T6",
      reasonCode: "duplicate_bot_pr_review",
      evidenceRefs: ["ev:github:fusion_dup_pr_22"],
    },
  ],
};

export function computeEvalWaterfallAndEconomics(
  statement: ClearedWorkStatementInput,
): EvalWaterfallAndEconomics {
  const totalBilledMicro = statement.lines.reduce((acc, l) => acc + l.billedMicro, 0n);
  const totalClearedMicro = statement.lines.reduce((acc, l) => acc + l.clearedPayableMicro, 0n);
  const shieldedMicro = totalBilledMicro - totalClearedMicro;
  const bpsBig = totalBilledMicro > 0n ? (shieldedMicro * 10_000n) / totalBilledMicro : 0n;
  const leakageBps = Number(bpsBig);
  const leakagePctFmt = `${(bpsBig / 100n).toString()}.${(bpsBig % 100n).toString().padStart(2, "0")}%`;

  if (statement.statementId.includes("VAPI")) {
    return {
      presetKey: "vapi",
      payeeMerchantId: statement.payeeMerchantId,
      pricingModelLabel: "Voice Minutes + BYOK Pass-Through (32,400 cleared mins)",
      contractedUnitRateFormatted: "$0.05/min",
      unverifiedEffectiveUnitCostFormatted: "$0.06/min (if paid unverified)",
      verifiedClearedUnitCostFormatted: "$0.05/min (post-Floe capture)",
      leakagePreventedFormatted: `$${formatMicroToDecimal(shieldedMicro)}`,
      leakagePercentFormatted: leakagePctFmt,
      leakageBasisPoints: leakageBps,
      scopeKeyAttribution: "scope_key: vapi:proj_northwind_voice_inbound",
      kpiSubtitles: {
        billed: "38,000 claimed voice minutes (1,900,000,000 micro-USD)",
        captured: "32,400 verified connected voice minutes settled to Vapi",
        voided: "3,700 mins unconnected / SIP 480-486 failed calls (T5)",
        held: "1,900 mins BYOK Deepgram/ElevenLabs pass-through rebilled (T2)",
      },
      mcpFixture: {
        requestId: "req_demo_vapi_001",
        taskId: "tsk_demo_vapi_001",
        vendor: "vapi",
        taskType: "voice_call",
        operation: "connect_inbound_voice_call",
        requestedMicro: 250_000n,
        cumulativePeriodMicro: 1_619_750_000n,
        evidenceRef: "ev:vapi:call_logs_verified_32400m",
        buttonLabel: "1. MCP Authorize ($0.25)",
      },
      evalWaterfall: {
        tierA_BuyerEval: "[a] buyer_eval: LangSmith + SIP Trunk CDRs (185.00 USD T5 unconnected voided)",
        tierB_VendorEval: "[b] vendor_eval: Vapi Call Export (38,000 mins claimed)",
        tierC_FloeDeterministicEval: "[c] floe_eval: BYOK API Key Overlap Audit (95.00 USD T2 held)",
      },
    };
  }

  if (statement.statementId.includes("ENG")) {
    return {
      presetKey: "autonomous_eng",
      payeeMerchantId: statement.payeeMerchantId,
      pricingModelLabel: "Seats + Nano-Credit v2 Agent Tasks (2,840 cleared units)",
      contractedUnitRateFormatted: "$1.00/unit",
      unverifiedEffectiveUnitCostFormatted: "$1.11/unit (if paid unverified)",
      verifiedClearedUnitCostFormatted: "$1.00/unit (post-Floe capture)",
      leakagePreventedFormatted: `$${formatMicroToDecimal(shieldedMicro)}`,
      leakagePercentFormatted: leakagePctFmt,
      leakageBasisPoints: leakageBps,
      scopeKeyAttribution: "scope_key: github:org:northwind-eng + cursor:team_core",
      kpiSubtitles: {
        billed: "3,160 billed seat + nano-credit v2 agent units (3,160,000,000 micro-USD)",
        captured: "2,840 verified seats & merged PR tasks settled to Eng Bundle",
        voided: "210 errored / HTTP 5xx aborted Cursor fast-requests (T5)",
        held: "110 duplicate bot reviews on abandoned draft PRs (T6)",
      },
      mcpFixture: {
        requestId: "req_demo_eng_001",
        taskId: "tsk_demo_eng_001",
        vendor: "github_copilot",
        taskType: "code_review",
        operation: "execute_agent_pr_review",
        requestedMicro: 1_000_000n,
        cumulativePeriodMicro: 2_839_000_000n,
        evidenceRef: "ev:github:copilot_v2_merged_prs",
        buttonLabel: "1. MCP Authorize ($1.00)",
      },
      evalWaterfall: {
        tierA_BuyerEval: "[a] buyer_eval: GitHub Actions CI + Merged PR Graph (2,840 units cleared)",
        tierB_VendorEval: "[b] vendor_eval: Cursor + Copilot Nano-Credit v2 Billing Exports",
        tierC_FloeDeterministicEval: "[c] floe_eval: Copilot Fusion Duplicate Bot Review Detector ($320.00 shielded)",
      },
    };
  }

  const clearedOutcomes = 4378n;
  const centMicro = 10_000n;
  const unverifiedPerOutcomeCents =
    (totalBilledMicro * 2n + clearedOutcomes * centMicro) / (2n * clearedOutcomes * centMicro);
  const unverifiedPerOutcomeMicro = unverifiedPerOutcomeCents * centMicro;

  return {
    presetKey: "fin",
    payeeMerchantId: statement.payeeMerchantId,
    pricingModelLabel: "Outcome Billing (4,378 verified resolutions @ $0.99)",
    contractedUnitRateFormatted: "$0.99/outcome",
    unverifiedEffectiveUnitCostFormatted: `$${formatMicroToDecimal(unverifiedPerOutcomeMicro)}/outcome (if paid unverified)`,
    verifiedClearedUnitCostFormatted: "$0.99/outcome (post-Floe capture)",
    leakagePreventedFormatted: `$${formatMicroToDecimal(shieldedMicro)}`,
    leakagePercentFormatted: leakagePctFmt,
    leakageBasisPoints: leakageBps,
    scopeKeyAttribution: "scope_key: intercom:workspace:northwind_cx_prod",
    kpiSubtitles: {
      billed: "4,576 billed resolutions @ $0.99 (4,530,240,000 micro-USD)",
      captured: "4,378 verified autonomous resolutions settled to Fin AI",
      voided: "143 conversations reopened within 5-day contract window",
      held: "55 human-assisted conversations + PROOF_OF_FULFILLMENT pack",
    },
    mcpFixture: {
      requestId: "req_demo_fin_001",
      taskId: "tsk_demo_fin_001",
      vendor: "fin",
      taskType: "support_resolution",
      operation: "resolve_conversation",
      requestedMicro: 990_000n,
      cumulativePeriodMicro: 4_333_230_000n,
      evidenceRef: "ev:intercom:conv_batch_verified_4378",
      buttonLabel: "1. MCP Authorize ($0.99)",
    },
    evalWaterfall: {
      tierA_BuyerEval: "[a] buyer_eval: Intercom CSAT + 5-Day Reopen Telemetry ($141.57 T5 voided)",
      tierB_VendorEval: "[b] vendor_eval: Fin AI Resolution Claim Feed (4,576 billed outcomes)",
      tierC_FloeDeterministicEval: "[c] floe_eval: Human-Teammate Handoff Sequence Detector ($54.45 T6 held)",
    },
  };
}
