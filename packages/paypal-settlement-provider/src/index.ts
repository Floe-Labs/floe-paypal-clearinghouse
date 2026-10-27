import { createHash, createVerify } from "node:crypto";

export type TClassCode = "T1" | "T2" | "T3" | "T4" | "T5" | "T6" | "T7";
export type VendorVisibleTClassCode = Exclude<TClassCode, "T1">;

export interface ClearedStatementLine {
  readonly lineKey: string;
  readonly description: string;
  readonly billedMicro: bigint;
  readonly clearedPayableMicro: bigint;
  readonly excludedCreditMicro: bigint;
  readonly heldInDisputeMicro: bigint;
  readonly verified?: boolean;
  readonly contractValid?: boolean;
  readonly buyerAccepted?: boolean;
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
  readonly periodStartIso?: string;
  readonly periodEndIso?: string;
  readonly lines: readonly ClearedStatementLine[];
}

export interface PayPalOrderV2AuthPayload {
  readonly intent: "AUTHORIZE";
  readonly payPalRequestId: string;
  readonly purchase_units: readonly [{
    readonly reference_id: string;
    readonly custom_id: string;
    readonly invoice_id: string;
    readonly payee: { readonly merchant_id: string };
    readonly amount: { readonly currency_code: string; readonly value: string };
  }];
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

export interface PayPalCaptureRequestPayload {
  readonly invoice_id: string;
  readonly note_to_payer: string;
  readonly final_capture: boolean;
  readonly amount: { readonly currency_code: string; readonly value: string };
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
  readonly capturePayload: PayPalCaptureRequestPayload | null;
  readonly disputeEvidencePack?: PayPalDisputeEvidencePack;
  readonly planHash: string;
}

export interface PayPalPayoutBatchPayload {
  readonly sender_batch_header: { readonly sender_batch_id: string; readonly email_subject: string; readonly email_message: string };
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
  readonly resource: { readonly id: string; readonly custom_id?: string; readonly invoice_id?: string; readonly amount?: { readonly currency_code: string; readonly value: string } };
  readonly create_time: string;
}

export interface PayPalTransmissionHeaders {
  readonly transmissionId: string;
  readonly transmissionTime: string;
  readonly transmissionSig: string;
  readonly certUrl: string;
  readonly authAlgo: string;
}

export function deterministicHash(value: unknown): string {
  const canonical = JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  if (canonical === undefined) throw new Error("Cannot compute deterministicHash for an unserializable or undefined value.");
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function formatMicroToDecimal(micro: bigint): string {
  if (micro < 0n) throw new Error(`Negative micro-unit amount (${micro}) cannot be formatted for PayPal API.`);
  const whole = micro / 1_000_000n;
  const remainder = micro % 1_000_000n;
  if (remainder % 10_000n !== 0n) throw new Error(`Sub-cent remainder (${remainder} micro) requires explicit rounding policy before PayPal settlement.`);
  return `${whole.toString()}.${(remainder / 10_000n).toString().padStart(2, "0")}`;
}

function validateStatementLine(line: ClearedStatementLine): void {
  if (line.billedMicro < 0n || line.clearedPayableMicro < 0n || line.excludedCreditMicro < 0n || line.heldInDisputeMicro < 0n) {
    throw new Error(`Negative micro-unit amount on statement line ${line.lineKey} is not permitted.`);
  }
  if (line.clearedPayableMicro + line.excludedCreditMicro + line.heldInDisputeMicro !== line.billedMicro) {
    throw new Error(`Conservation violation on statement line ${line.lineKey}: partitions do not sum to billedMicro.`);
  }
  if (line.clearedPayableMicro > 0n && (line.verified === false || line.contractValid === false || line.buyerAccepted === false)) {
    throw new Error(`Verification gate violation on line ${line.lineKey}: unverified, contract-invalid, or buyer-rejected work cannot be marked payable.`);
  }
}

export function buildPayPalOrderAuthorization(statement: ClearedWorkStatementInput): PayPalOrderV2AuthPayload {
  for (const line of statement.lines) validateStatementLine(line);
  const totalBilledMicro = statement.lines.reduce((acc, l) => acc + l.billedMicro, 0n);
  if (totalBilledMicro <= 0n) throw new Error("Total billed micro must be positive to create a PayPal Order v2 authorization.");
  const payPalRequestId = deterministicHash({ op: "paypal.orders.v2.authorize", statementId: statement.statementId, statementVersion: statement.statementVersion, statementHash: statement.statementHash });
  return {
    intent: "AUTHORIZE",
    payPalRequestId,
    purchase_units: [{
      reference_id: statement.statementId,
      custom_id: `${statement.orgId}:${statement.statementHash}`,
      invoice_id: `${statement.statementId}-v${statement.statementVersion}`,
      payee: { merchant_id: statement.payeeMerchantId },
      amount: { currency_code: statement.currency, value: formatMicroToDecimal(totalBilledMicro) },
    }],
  };
}

export function buildPayPalSplitCapturePlan(statement: ClearedWorkStatementInput, orderId: string, authorizationId: string): PayPalSplitCapturePlan {
  let totalAuthorizedMicro = 0n;
  let capturePayableMicro = 0n;
  let voidExcludedMicro = 0n;
  let heldDisputedMicro = 0n;
  for (const line of statement.lines) {
    validateStatementLine(line);
    totalAuthorizedMicro += line.billedMicro;
    capturePayableMicro += line.clearedPayableMicro;
    voidExcludedMicro += line.excludedCreditMicro;
    heldDisputedMicro += line.heldInDisputeMicro;
  }
  if (capturePayableMicro > totalAuthorizedMicro) throw new Error(`Capture amount (${capturePayableMicro}) cannot exceed totalAuthorizedMicro (${totalAuthorizedMicro}).`);
  const finalCapture = heldDisputedMicro === 0n;
  const payPalRequestId = deterministicHash({ op: "paypal.authorizations.capture", orderId, authorizationId, statementId: statement.statementId, statementHash: statement.statementHash, capturePayableMicro: capturePayableMicro.toString(), finalCapture });
  const excludedLines = statement.lines
    .filter((l) => l.excludedCreditMicro + l.heldInDisputeMicro > 0n)
    .map((l) => {
      if (!l.tClass || !l.reasonCode) throw new Error(`Excluded or disputed line ${l.lineKey} must declare both tClass and reasonCode.`);
      if (l.tClass === "T1") throw new Error(`Line ${l.lineKey} carries buyer-only classification T1 and must not be disclosed in vendor-facing PayPal evidence.`);
      return { lineKey: l.lineKey, tClass: l.tClass, reasonCode: l.reasonCode, amountMicro: l.excludedCreditMicro + l.heldInDisputeMicro, evidenceRefs: l.evidenceRefs };
    });
  const disputeEvidencePack: PayPalDisputeEvidencePack | undefined = excludedLines.length > 0 ? {
    disputeReferenceId: `dsp:${statement.statementId}:v${statement.statementVersion}`,
    statementId: statement.statementId,
    statementHash: statement.statementHash,
    excludedTotalMicro: voidExcludedMicro,
    disputedTotalMicro: heldDisputedMicro,
    evidenceType: "PROOF_OF_FULFILLMENT",
    notes: `Floe Cleared Work Statement ${statement.statementId} (v${statement.statementVersion}, hash ${statement.statementHash}). Verified payable=${formatMicroToDecimal(capturePayableMicro)} ${statement.currency}; excluded=${formatMicroToDecimal(voidExcludedMicro)} ${statement.currency}; held=${formatMicroToDecimal(heldDisputedMicro)} ${statement.currency}.`,
    excludedLines,
    packHash: deterministicHash({ statementId: statement.statementId, statementHash: statement.statementHash, excludedLines }),
  } : undefined;
  const capturePayload: PayPalCaptureRequestPayload | null = capturePayableMicro > 0n ? {
    invoice_id: `${statement.statementId}-v${statement.statementVersion}`,
    note_to_payer: `Cleared Work Statement ${statement.statementId} (${statement.statementHash})`,
    final_capture: finalCapture,
    amount: { currency_code: statement.currency, value: formatMicroToDecimal(capturePayableMicro) },
  } : null;
  const planBase = {
    orderId, authorizationId, statementId: statement.statementId, statementHash: statement.statementHash,
    payPalRequestId, totalAuthorizedMicro, capturePayableMicro, voidExcludedMicro, heldDisputedMicro,
    finalCapture, capturePayload, ...(disputeEvidencePack ? { disputeEvidencePack } : {}),
  };
  return { ...planBase, planHash: deterministicHash(planBase) };
}

export function buildMultiVendorPayoutBatch(batchId: string, statements: readonly ClearedWorkStatementInput[]): PayPalPayoutBatchPayload {
  const items: PayPalPayoutBatchPayload["items"][number][] = [];
  for (const stmt of statements) {
    for (const line of stmt.lines) validateStatementLine(line);
    const payableMicro = stmt.lines.reduce((acc, l) => acc + l.clearedPayableMicro, 0n);
    if (payableMicro === 0n) continue;
    items.push({
      recipient_type: "PAYPAL_ID",
      receiver: stmt.payeeMerchantId,
      note: `Floe Cleared Work Settlement ${stmt.statementId} (${stmt.statementHash})`,
      sender_item_id: `${stmt.statementId}:v${stmt.statementVersion}`,
      amount: { value: formatMicroToDecimal(payableMicro), currency: stmt.currency },
    });
  }
  return {
    sender_batch_header: { sender_batch_id: batchId, email_subject: "Floe Cleared Work Statement Disbursement", email_message: "Verified AI work obligations have been cleared and settled." },
    items,
  };
}

export function crc32Decimal(rawBody: string): number {
  let crc = 0xffffffff;
  for (const byte of Buffer.from(rawBody, "utf8")) {
    crc ^= byte;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isTrustedPayPalCertUrl(certUrl: string): boolean {
  try {
    const parsed = new URL(certUrl);
    return parsed.protocol === "https:" && (parsed.hostname === "api.paypal.com" || parsed.hostname === "api.sandbox.paypal.com");
  } catch {
    return false;
  }
}

export function verifyAndDeduplicatePayPalWebhook(input: {
  readonly rawBody: string;
  readonly headers: PayPalTransmissionHeaders;
  readonly webhookId: string;
  readonly paypalPublicKeyPem: string;
  readonly processedEventIds?: ReadonlySet<string>;
  readonly claimEventId?: (eventId: string) => boolean;
}): {
  readonly verified: boolean;
  readonly duplicate: boolean;
  readonly eventId: string | null;
  readonly event: PayPalWebhookEvent | null;
  readonly nextProcessedEventIds: ReadonlySet<string>;
} {
  const existingSet = input.processedEventIds ?? new Set<string>();
  const { headers } = input;
  if (!headers.transmissionId || !headers.transmissionTime || !headers.transmissionSig || !input.webhookId || headers.authAlgo !== "SHA256withRSA" || !isTrustedPayPalCertUrl(headers.certUrl)) {
    return { verified: false, duplicate: false, eventId: null, event: null, nextProcessedEventIds: existingSet };
  }
  const message = `${headers.transmissionId}|${headers.transmissionTime}|${input.webhookId}|${crc32Decimal(input.rawBody)}`;
  let validSig = false;
  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(message, "utf8");
    verifier.end();
    validSig = verifier.verify(input.paypalPublicKeyPem, Buffer.from(headers.transmissionSig, "base64"));
  } catch {
    validSig = false;
  }
  if (!validSig) return { verified: false, duplicate: false, eventId: null, event: null, nextProcessedEventIds: existingSet };
  let parsed: PayPalWebhookEvent;
  try {
    parsed = JSON.parse(input.rawBody) as PayPalWebhookEvent;
    if (!parsed || typeof parsed.id !== "string" || !parsed.id) return { verified: false, duplicate: false, eventId: null, event: null, nextProcessedEventIds: existingSet };
  } catch {
    return { verified: false, duplicate: false, eventId: null, event: null, nextProcessedEventIds: existingSet };
  }
  const claimed = input.claimEventId ? input.claimEventId(parsed.id) : !existingSet.has(parsed.id);
  if (!claimed) return { verified: true, duplicate: true, eventId: parsed.id, event: parsed, nextProcessedEventIds: existingSet };
  const next = new Set(existingSet);
  next.add(parsed.id);
  return { verified: true, duplicate: false, eventId: parsed.id, event: parsed, nextProcessedEventIds: next };
}
