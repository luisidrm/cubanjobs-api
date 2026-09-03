import { beforeEach, describe, expect, it, vi } from "vitest";
import supertokens from "supertokens-node";
import { rollbackSuperTokensUser } from "./supertokens";

vi.mock("supertokens-node", () => ({
  default: { deleteUser: vi.fn() },
}));

describe("rollbackSuperTokensUser", () => {
  beforeEach(() => {
    vi.mocked(supertokens.deleteUser).mockReset();
  });

  it("succeeds on the first attempt", async () => {
    vi.mocked(supertokens.deleteUser).mockResolvedValueOnce(undefined as never);

    await rollbackSuperTokensUser("user-1");

    expect(supertokens.deleteUser).toHaveBeenCalledTimes(1);
    expect(supertokens.deleteUser).toHaveBeenCalledWith("user-1");
  });

  it("retries once and succeeds on the second attempt", async () => {
    vi.mocked(supertokens.deleteUser)
      .mockRejectedValueOnce(new Error("transient failure"))
      .mockResolvedValueOnce(undefined as never);

    await rollbackSuperTokensUser("user-2");

    expect(supertokens.deleteUser).toHaveBeenCalledTimes(2);
  });

  it("gives up after two failed attempts without throwing", async () => {
    vi.mocked(supertokens.deleteUser).mockRejectedValue(new Error("permanent failure"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    // This is the orphaned-user scenario: rollback itself fails, leaving a
    // SuperTokens account with no matching `users` row. The function
    // deliberately doesn't throw — the caller (signUpPOST) already surfaces
    // its own AppError to the client regardless of rollback outcome.
    await expect(rollbackSuperTokensUser("user-3")).resolves.toBeUndefined();

    expect(supertokens.deleteUser).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("CRITICAL"),
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });
});
