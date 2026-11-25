/**
 * Cheap text checks for the most common job scam: asking the applicant to pay before they start.
 * It only looks for clear phrases, one sentence at a time, and skips sentences that deny it
 * ("no pedimos pago por adelantado"), so honest postings that mention the rule are left alone.
 * A hit never blocks a posting on its own: it warns the employer and puts the job in the admin queue.
 */

export type ScamSignal = "upfront_payment";

// Compared on lowercase text with accents removed, so "depósito" and "deposito" match alike.
const UPFRONT_PATTERNS: RegExp[] = [
  // "pago por adelantado", "pagar anticipado", "depositar antes de empezar", "enviar dinero previo"
  /\b(pago|pagar|abonar|abono|deposito|depositar|transferir|transferencia|enviar|mandar|envio)\b[^.!?\n]{0,40}\b(adelantado|anticipado|anticipo|de antemano|previo|previamente|antes de (empezar|comenzar|trabajar|iniciar|ingresar))\b/,
  // "cuota para empezar", "fianza para trabajar", "inscripcion para ingresar"
  /\b(cuota|tarifa|costo|coste|fianza|deposito|inscripcion|matricula|garantia)\b[^.!?\n]{0,30}\b(para|de) (empezar|comenzar|trabajar|iniciar|ingresar|aplicar|postular|garantizar)\b/,
  // "paga para trabajar", "tienes que pagar para empezar"
  /\bpag(a|ar|as|e|es)\b[^.!?\n]{0,25}\bpara (empezar|comenzar|trabajar|iniciar|ingresar|ser contratad[oa])\b/,
  // English
  /\b(upfront|up-front|advance|registration|training|processing|application|starter kit)\s+(fee|payment|deposit|cost)\b/,
  /\bpay\b[^.!?\n]{0,30}\b(fee|deposit)\b[^.!?\n]{0,30}\b(start|begin|work|apply|get hired)\b/,
  /\bsend (me |us )?(some )?money\b/,
];

const NEGATION = /\b(no|sin|nunca|jamas|ni|tampoco|never|without|dont|do not|does not|not)\b/;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "");
}

/** Which scam signals appear in the text. Empty when nothing suspicious is found. */
export function detectScamSignals(...texts: (string | null | undefined)[]): ScamSignal[] {
  const body = normalize(texts.filter(Boolean).join("\n"));
  const sentences = body.split(/(?<=[.!?])\s+|\n+/);
  for (const sentence of sentences) {
    if (!sentence.trim()) continue;
    if (NEGATION.test(sentence)) continue;
    if (UPFRONT_PATTERNS.some((p) => p.test(sentence))) return ["upfront_payment"];
  }
  return [];
}
