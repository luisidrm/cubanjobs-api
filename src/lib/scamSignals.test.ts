import { describe, expect, it } from "vitest";
import { detectScamSignals } from "./scamSignals";

describe("detectScamSignals", () => {
  it.each([
    "Para empezar debes hacer un pago por adelantado de 50 USD.",
    "Se requiere depósito antes de empezar a trabajar",
    "Hay que enviar dinero previo para reservar tu puesto",
    "Cuota para empezar: 20 MLC",
    "Tienes que pagar para trabajar con nosotros",
    "Inscripción para ingresar al equipo",
    "A small upfront fee is required to get started",
    "You must pay a deposit to start working",
    "Please send money first",
  ])("flags: %s", (text) => {
    expect(detectScamSignals(text)).toEqual(["upfront_payment"]);
  });

  it.each([
    "Cocinero con experiencia. Salario 8000 CUP al mes. Horario de lunes a viernes.",
    "Diseñador gráfico remoto, pago mensual por transferencia",
    "Pagamos puntualmente cada quincena",
    "Se ofrece capacitación gratuita y uniforme",
    "Experience with advance planning and training new staff",
  ])("leaves a normal posting alone: %s", (text) => {
    expect(detectScamSignals(text)).toEqual([]);
  });

  it("ignores sentences that deny the practice", () => {
    expect(detectScamSignals("No pedimos pago por adelantado. Contratación directa.")).toEqual([]);
    expect(detectScamSignals("Sin cuota para empezar ni depósito.")).toEqual([]);
    expect(detectScamSignals("We never ask for an upfront fee.")).toEqual([]);
  });

  it("still flags a bad sentence next to an honest one", () => {
    expect(detectScamSignals("No cobramos comisión. Debes hacer un pago por adelantado de 30 USD.")).toEqual(["upfront_payment"]);
  });

  it("checks every text it is given and ignores empty values", () => {
    expect(detectScamSignals("Barista", null, undefined, "Cuota para empezar: 10 USD")).toEqual(["upfront_payment"]);
    expect(detectScamSignals(null, undefined, "")).toEqual([]);
  });
});
