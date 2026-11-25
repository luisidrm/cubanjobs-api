/**
 * What an applicant is told when their application moves to a new stage. One place for the
 * in-app notification, the email and the push, in Spanish like the rest of the product.
 */

export type ApplicationStage = "pending" | "reviewed" | "interview" | "accepted" | "rejected" | "withdrawn";

const STAGE: Record<ApplicationStage, { title: string; body: (job: string, company: string) => string }> = {
  pending: { title: "Tu solicitud está pendiente", body: (j, c) => `Tu solicitud para ${j} en ${c} volvió a estar pendiente.` },
  reviewed: { title: "Revisaron tu solicitud", body: (j, c) => `${c} revisó tu solicitud para ${j}.` },
  interview: { title: "¡Pasas a entrevista!", body: (j, c) => `${c} quiere entrevistarte para ${j}. Atento a su contacto.` },
  accepted: { title: "¡Te aceptaron!", body: (j, c) => `${c} aceptó tu solicitud para ${j}. ¡Felicidades!` },
  rejected: { title: "Respuesta a tu solicitud", body: (j, c) => `${c} no continuará con tu solicitud para ${j}. ¡Sigue intentándolo!` },
  withdrawn: { title: "Retiraste tu solicitud", body: (j, c) => `Retiraste tu solicitud para ${j} en ${c}.` },
};

export function stageMessage(status: ApplicationStage, jobTitle: string, companyName: string) {
  const s = STAGE[status];
  return { title: s.title, body: s.body(jobTitle, companyName) };
}

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Job titles and names are typed by users: they must never become markup in an email. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ENTITIES[ch] as string);
}

export function stageEmail(status: ApplicationStage, applicantName: string, jobTitle: string, companyName: string) {
  const { title, body } = stageMessage(status, jobTitle, companyName);
  return {
    subject: `${title} · ${jobTitle}`,
    html: `<p>Hola ${escapeHtml(applicantName)}:</p><p>${escapeHtml(body)}</p><p>Puedes ver el estado de tus solicitudes en Brújula.</p>`,
  };
}
