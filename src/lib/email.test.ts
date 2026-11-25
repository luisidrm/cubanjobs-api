import { describe, expect, it, vi } from "vitest";

const send = vi.fn(async () => ({ error: null }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

const { isUndeliverableTestAddress, sendEmail } = await import("./email");

describe("test addresses", () => {
  it.each(["a@example.com", "a@EXAMPLE.org", "a@mail.example.net", "e2e@something.test", "x@y.invalid", "x@app.localhost"])("%s is never sent", (to) => {
    expect(isUndeliverableTestAddress(to)).toBe(true);
  });

  it.each(["ana@gmail.com", "ana@nauta.cu", "ana@myexample.com", "ana@example.com.cu", "ana@contest.com", "admin@cubanjobs.dev"])("%s is a normal address", (to) => {
    expect(isUndeliverableTestAddress(to)).toBe(false);
  });

  it("skips Resend for a test address and uses it for a real one", async () => {
    await sendEmail({ to: "a@example.com", subject: "s", html: "<p>h</p>" });
    expect(send).not.toHaveBeenCalled();

    await sendEmail({ to: "ana@gmail.com", subject: "s", html: "<p>h</p>" });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
