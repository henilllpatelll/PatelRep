import { deferAuthHydration } from "@/lib/auth/deferAuthHydration";

describe("deferAuthHydration", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("does not run Supabase follow-up work inside the auth-state callback", async () => {
    jest.useFakeTimers();
    const hydrate = jest.fn().mockResolvedValue(undefined);

    expect(deferAuthHydration(hydrate)).toBeUndefined();
    expect(hydrate).not.toHaveBeenCalled();

    jest.runOnlyPendingTimers();
    await Promise.resolve();

    expect(hydrate).toHaveBeenCalledTimes(1);
  });
});
