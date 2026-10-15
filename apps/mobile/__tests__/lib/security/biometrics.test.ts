describe("biometrics when the installed app lacks expo-local-authentication", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("reports no biometrics and refuses to prompt instead of throwing at import", async () => {
    jest.doMock("expo-local-authentication", () => {
      throw new Error("Cannot find native module 'ExpoLocalAuthentication'");
    });
    // Importing must not throw: an older binary receives this JS over the air.
    const biometrics = require("@/lib/security/biometrics") as typeof import("@/lib/security/biometrics");

    await expect(biometrics.getBiometricCapability()).resolves.toEqual({ available: false, reason: "unsupported" });
    await expect(biometrics.authenticate("Unlock", "Cancel")).resolves.toBe("unavailable");
  });

  it("uses the module when it is present", async () => {
    jest.doMock("expo-local-authentication", () => ({
      hasHardwareAsync: jest.fn().mockResolvedValue(true),
      isEnrolledAsync: jest.fn().mockResolvedValue(true),
      supportedAuthenticationTypesAsync: jest.fn().mockResolvedValue([2]),
      authenticateAsync: jest.fn().mockResolvedValue({ success: true }),
      AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
    }));
    const biometrics = require("@/lib/security/biometrics") as typeof import("@/lib/security/biometrics");

    await expect(biometrics.getBiometricCapability()).resolves.toEqual({ available: true, kind: "face" });
    await expect(biometrics.authenticate("Unlock", "Cancel")).resolves.toBe("success");
  });
});
