import { classifyAuthError, isValidEmail, normalizeEmail } from "@/lib/auth/authErrors";

describe("classifyAuthError", () => {
  it.each([
    [{ code: "invalid_credentials", status: 400, message: "Invalid login credentials" }, "invalidCredentials"],
    [{ message: "Invalid login credentials" }, "invalidCredentials"],
    [{ code: "email_not_confirmed" }, "emailNotConfirmed"],
    [{ code: "over_email_send_rate_limit", status: 429 }, "rateLimited"],
    [{ status: 429 }, "rateLimited"],
    [{ code: "otp_expired", message: "Email link is invalid or has expired" }, "linkExpired"],
    [{ code: "flow_state_not_found" }, "linkExpired"],
    [{ code: "weak_password" }, "weakPassword"],
    [{ code: "same_password" }, "samePassword"],
    [{ code: "reauthentication_needed" }, "reauthRequired"],
    [{ code: "session_not_found" }, "session"],
    [{ message: "Auth session missing!" }, "session"],
    [{ name: "AuthRetryableFetchError", message: "Failed to fetch" }, "offline"],
    [{ message: "Network request failed" }, "offline"],
    [{ message: "something nobody planned for" }, "generic"],
  ])("maps %j to %s", (err, expected) => {
    expect(classifyAuthError(err)).toBe(expected);
  });

  it("is safe with null/undefined/non-errors", () => {
    expect(classifyAuthError(null)).toBe("generic");
    expect(classifyAuthError(undefined)).toBe("generic");
    expect(classifyAuthError("boom")).toBe("generic");
  });
});

describe("email helpers", () => {
  it("normalises case and surrounding whitespace", () => {
    expect(normalizeEmail("  Maria.Vega@Hotel.COM \n")).toBe("maria.vega@hotel.com");
  });

  it.each(["a@b.co", "first.last+tag@sub.example.org"])("accepts %s", (e) => expect(isValidEmail(e)).toBe(true));
  it.each(["", "plain", "a@b", "a b@c.com", "@c.com", "a@.com"])("rejects %j", (e) => expect(isValidEmail(e)).toBe(false));
});

describe("classifyAuthError ordering", () => {
  it("tells 'same password' apart from 'weak password' even when both messages say 'password should be'", () => {
    expect(classifyAuthError({ message: "New password should be different from the old password." })).toBe("samePassword");
    expect(classifyAuthError({ message: "Password should be at least 6 characters." })).toBe("weakPassword");
  });
});
