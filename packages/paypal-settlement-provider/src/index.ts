import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type TClassCode = "T1" | "T2" | "T3" | "T4" | "T5" | "T6" | "T7";
export type VendorVisibleTClassCode = Exclude<TClassCode, "T1">;

export interface ClearedStatementLine {
  readonly lineKey: string;
  readonly description: string;
  readonly billedMicro: bigint;
  readonly clearedPayableMicro: bigint;
  readonly excludedCreditMicro: bigint;
  readonly heldInDisputeMicro: bigint;
  readonly tClass?: TClassCode;
  readonly reasonCode?: string;
  readonly evidenceRefs: readonly string[];
}

export interface ClearedWorkStatementInput {
  readonly statementId: string;
  readonly statementVersion: number;
  readonly statementHash: string;
  readonly orgId: string;
  readonly buyerName: string;
  readonly vendorName: string;
  readonly payeeMerchantId: string;
  readonly currency: "USD" | "EUR" | "GBP";
  readonly lines: readonly ClearedStatementLine[];
}

export interface PayPalOrderV2AuthPayload {
  readonly intent: "AUTHORIZE";
  readonly payPalRequestId: string;
  readonly purchase_units: readonly [
    {
      readonly reference_id: string;
      readonly custom_id: string;
      readonly invoice_id: string;
      readonly payee: { readonly merchant_id: string };
      readonly amount: { readonly currency_code: string; readonly value: string };
    },
  ];
}

export interface PayPalDisputeEvidencePack {
  readonly disputeReferenceId: string;
  readonly statementId: string;
  readonly statementHash: string;
  readonly excludedTotalMicro: bigint;
  readonly disputedTotalMicro: bigint;
  readonly evidenceType: "PROOF_OF_FULFILLMENT" | "OTHER";
  readonly notes: string;
  readonly excludedLines: readonly {
    readonly lineKey: string;
    readonly tClass: VendorVisibleTClassCode;
    readonly reasonCode: string;
    readonly amountMicro: bigint;
    readonly evidenceRefs: readonly string[];
  }[];
  readonly packHash: string;
}

export interface PayPalSplitCapturePlan {
  readonly orderId: string;
  readonly authorizationId: string;
  readonly statementId: string;
  readonly statementHash: string;
  readonly payPalRequestId: string;
  readonly totalAuthorizedMicro: bigint;
  readonly capturePayableMicro: bigint;
  readonly voidExcludedMicro: bigint;
  readonly heldDisputedMicro: bigint;
  readonly finalCapture: boolean;
  readonly capturePayload: {
    readonly invoice_id: string;
    readonly note_to_payer: string;
    readonly final_capture: boolean;
    readonly amount: { readonly currency_code: string; readonly value: string };
  };
  readonly disputeEvidencePack?: PayPalDisputeEvidencePack;
  readonly planHash: string;
}

export interface PayPalPayoutBatchPayload {
  readonly sender_batch_header: {
    readonly sender_batch_id: string;
    readonly email_subject: string;
    readonly email_message: string;
  };
  readonly items: readonly {
    readonly recipient_type: "PAYPAL_ID";
    readonly receiver: string;
    readonly note: string;
    readonly sender_item_id: string;
    readonly amount: { readonly value: string; readonly currency: string };
  }[];
}

export interface PayPalWebhookEvent {
  readonly id: string;
  readonly event_type:
    | "PAYMENT.AUTHORIZATION.CREATED"
    | "PAYMENT.AUTHORIZATION.VOIDED"
    | "PAYMENT.CAPTURE.COMPLETED"
    | "CUSTOMER.DISPUTE.CREATED"
    | "CUSTOMER.DISPUTE.RESOLVED";
  readonly resource: {
    readonly id: string;
    readonly custom_id?: string;
    readonly invoice_id?: string;
    readonly amount?: { readonly currency_code: string; readonly value: string };
  };
  readonly create_time: string;
}

export function deterministicHash(value: unknown): string {
  const canonical = JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function formatMicroToDecimal(micro: bigint): string {
  if (micro < 0n) throw new Error(`Negative micro-unit amount (${micro}) cannot be formatted for PayPal API.`);
  const whole = micro / 1_000_000n;
  const remainder = micro % 1_000_000n;
  if (remainder % 10_000n !== 0n) {
    throw new Error(`Sub-cent remainder (${remainder} micro) requires explicit rounding policy before PayPal settlement.`);
  }
  const cents = (remainder / 10_000n).toString().padStart(2, "0");
  return `${whole.toString()}.${cents}`;
}

export function buildPayPalOrderAuthorization(statement: ClearedWorkStatementInput): PayPalOrderV2AuthPayload {
  const totalBilledMicro = statement.lines.reduce((acc, l) => acc + l.billedMicro, 0n);
  if (totalBilledMicro <= 0n) throw new Error("Total billed micro must be positive to create a PayPal Order v2 authorization.");
  const payPalRequestId = deterministicHash({
    op: "paypal.orders.v2.authorize",
    statementId: statement.statementId,
    statementVersion: statement.statementVersion,
    statementHash: statement.statementHash,
  });
  return {
    intent: "AUTHORIZE",
    payPalRequestId,
    purchase_units: [
      {
        reference_id: statement.statementId,
        custom_id: `${statement.orgId}:${statement.statementHash}`,
        invoice_id: `${statement.statementId}-v${statement.statementVersion}`,
        payee: { merchant_id: statement.payeeMerchantId },
        amount: { currency_code: statement.currency, value: formatMicroToDecimal(totalBilledMicro) },
      },
    ],
  };
}

export function buildPayPalSplitCapturePlan(
  statement: ClearedWorkStatementInput,
  orderId: string,
  authorizationId: string,
): PayPalSplitCapturePlan {
  let totalAuthorizedMicro = 0n;
  let capturePayableMicro = 0n;
  let voidExcludedMicro = 0n;
  let heldDisputedMicro = 0n;
  for (const line of statement.lines) {
    if (line.clearedPayableMicro + line.excludedCreditMicro + line.heldInDisputeMicro !== line.billedMicro) {
      throw new Error(`Conservation violation on statement line ${line.lineKey}: partitions do not sum to billedMicro.`);
    }
    totalAuthorizedMicro += line.billedMicro;
    capturePayableMicro += line.clearedPayableMicro;
    voidExcludedMicro += line.excludedCreditMicro;
    heldDisputedMicro += line.heldInDisputeMicro;
  }
  const finalCapture = heldDisputedMicro === 0n;
  const payPalRequestId = deterministicHash({
    op: "paypal.authorizations.capture",
    orderId,
    authorizationId,
    statementId: statement.statementId,
    statementHash: statement.statementHash,
    capturePayableMicro: capturePayableMicro.toString(),
    finalCapture,
  });
  const excludedLines = statement.lines
    .filter((l) => l.excludedCreditMicro + l.heldInDisputeMicro > 0n)
    .map((l) => {
      if (!l.tClass || !l.reasonCode) {
        throw new Error(`Excluded or disputed line ${l.lineKey} must declare both tClass and reasonCode.`);
      }
      if (l.tClass === "T1") {
        throw new Error(
          `Line ${l.lineKey} carries buyer-only classification T1 and must not be disclosed in vendor-facing PayPal evidence.`,
        );
      }
      return {
        lineKey: l.lineKey,
        tClass: l.tClass,
        reasonCode: l.reasonCode,
        amountMicro: l.excludedCreditMicro + l.heldInDisputeMicro,
        evidenceRefs: l.evidenceRefs,
      };
    });
  const disputeEvidencePack: PayPalDisputeEvidencePack | undefined =
    excludedLines.length > 0
      ? {
          disputeReferenceId: `dsp:${statement.statementId}:v${statement.statementVersion}`,
          statementId: statement.statementId,
          statementHash: statement.statementHash,
          excludedTotalMicro: voidExcludedMicro,
          disputedTotalMicro: heldDisputedMicro,
          evidenceType: "PROOF_OF_FULFILLMENT",
          notes: `Floe Cleared Work Statement ${statement.statementId} (v${statement.statementVersion}, hash ${statement.statementHash}). Verified payable=${formatMicroToDecimal(capturePayableMicro)} ${statement.currency}; excluded=${formatMicroToDecimal(voidExcludedMicro)} ${statement.currency}; held=${formatMicroToDecimal(heldDisputedMicro)} ${statement.currency}.`,
          excludedLines,
          packHash: deterministicHash({ statementId: statement.statementId, statementHash: statement.statementHash, excludedLines }),
        }
      : undefined;
  const planBase = {
    orderId,
    authorizationId,
    statementId: statement.statementId,
    statementHash: statement.statementHash,
    payPalRequestId,
    totalAuthorizedMicro,
    capturePayableMicro,
    voidExcludedMicro,
    heldDisputedMicro,
    finalCapture,
    capturePayload: {
      invoice_id: `${statement.statementId}-v${statement.statementVersion}`,
      note_to_payer: `Cleared Work Statement ${statement.statementId} (${statement.statementHash})`,
      final_capture: finalCapture,
      amount: { currency_code: statement.currency, value: formatMicroToDecimal(capturePayableMicro) },
    },
    ...(disputeEvidencePack ? { disputeEvidencePack } : {}),
  };
  return { ...planBase, planHash: deterministicHash(planBase) };
}

export function buildMultiVendorPayoutBatch(
  batchId: string,
  statements: readonly ClearedWorkStatementInput[],
): PayPalPayoutBatchPayload {
  const items = statements.map((stmt) => {
    const payableMicro = stmt.lines.reduce((acc, l) => acc + l.clearedPayableMicro, 0n);
    return {
      recipient_type: "PAYPAL_ID" as const,
      receiver: stmt.payeeMerchantId,
      note: `Floe Cleared Work Settlement ${stmt.statementId} (${stmt.statementHash})`,
      sender_item_id: `${stmt.statementId}:v${stmt.statementVersion}`,
      amount: { value: formatMicroToDecimal(payableMicro), currency: stmt.currency },
    };
  });
  return {
    sender_batch_header: {
      sender_batch_id: batchId,
      email_subject: "Floe Cleared Work Statement Disbursement",
      email_message: "Verified AI work obligations have been cleared and settled.",
    },
    items,
  };
}

export function verifyAndDeduplicatePayPalWebhook(input: {
  readonly event: PayPalWebhookEvent;
  readonly rawBody: string;
  readonly signatureHeader: string;
  readonly webhookSecret: string;
  readonly processedEventIds: ReadonlySet<string>;
}): {
  readonly verified: boolean;
  readonly duplicate: boolean;
  readonly eventId: string;
  readonly nextProcessedEventIds: ReadonlySet<string>;
} {
  const expectedBuf = Buffer.from(
    createHmac("sha256", input.webhookSecret).update(input.rawBody).digest("hex"),
    "utf8",
  );
  const actualBuf = Buffer.from(input.signatureHeader, "utf8");
  const validSig =
    expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
  if (!validSig) {
    return { verified: false, duplicate: false, eventId: input.event.id, nextProcessedEventIds: input.processedEventIds };
  }
  if (input.processedEventIds.has(input.event.id)) {
    return { verified: true, duplicate: true, eventId: input.event.id, nextProcessedEventIds: input.processedEventIds };
  }
  const next = new Set(input.processedEventIds);
  next.add(input.event.id);
  return { verified: true, duplicate: false, eventId: input.event.id, nextProcessedEventIds: next };
}
