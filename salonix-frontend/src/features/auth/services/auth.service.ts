import { AxiosError } from "axios";
import { apiClient, refreshAccessToken } from "@/lib/api/api-client";
import type { AuthResponse } from "@/features/auth/types";
import type { LoginValues } from "@/features/auth/schemas/login.schema";
import type { RegisterValues } from "@/features/auth/schemas/register.schema";
import { clearAccessToken, setAccessToken } from "@/lib/auth/access-token";

function getAuthError(error: unknown, fallback = "Unable to sign in") {
  if (error instanceof AxiosError) {
    const response = error.response?.data as AuthResponse | undefined;
    return response?.error?.message ?? response?.error?.code ?? fallback;
  }

  return error instanceof Error ? error.message : "Unable to connect to the server";
}

export async function login(values: LoginValues) {
  try {
    const identifier = values.identifierType === "email"
      ? values.email?.trim().toLowerCase() ?? ""
      : `${values.countryCode}${values.phoneNumber?.replace(/^0+/, "") ?? ""}`;
    const payload = {
      account_type: "CUSTOMER" as const,
      identifier,
      password: values.password,
    };
    const response = await apiClient.post<AuthResponse>("/auth/login", payload, {
      withCredentials: true,
    });
    const token = response.data.data?.token;
    if (!token) throw new Error("Sign-in response did not contain an access token");
    setAccessToken(token);
    return response.data;
  } catch (error) {
    throw new Error(getAuthError(error));
  }
}

export async function register(values: RegisterValues) {
  try {
    const { confirmPassword, ...requestValues } = values;
    const localNumber = requestValues.phoneNumber.replace(/^0+/, "");
    const payload = {
      account_type: "CUSTOMER" as const,
      email: requestValues.email,
      password: requestValues.password,
      full_name: requestValues.fullName,
      phone_number: `${requestValues.countryCode}${localNumber}`,
    };
    const response = await apiClient.post<AuthResponse>(
      "/auth/register",
      payload,
      { withCredentials: true },
    );
    return response.data;
  } catch (error) {
    throw new Error(getAuthError(error));
  }
}

export async function requestPhoneVerification(phoneNumber: string) {
  const response = await apiClient.post<AuthResponse>(
    "/auth/phone-verifications",
    { account_type: "CUSTOMER", phone_number: phoneNumber },
  );
  return response.data;
}

export async function verifyPhone(phoneNumber: string, code: string) {
  const response = await apiClient.post<AuthResponse>(
    "/auth/phone-verifications/confirm",
    { account_type: "CUSTOMER", phone_number: phoneNumber, code },
  );
  const token = response.data.data?.token;
  if (!token) throw new Error("Verification response did not contain an access token");
  setAccessToken(token);
  return response.data;
}

export async function restoreSession() {
  const token = await refreshAccessToken();
  return { success: true, data: { token } };
}

export async function logout() {
  try {
    await apiClient.post("/auth/logout");
  } finally {
    clearAccessToken();
  }
}

export async function requestPasswordReset(identifier: string) {
  try {
    const response = await apiClient.post<AuthResponse>("/auth/password-resets", {
      account_type: "CUSTOMER",
      identifier,
    });
    return response.data;
  } catch (error) {
    throw new Error(getAuthError(error, "Unable to request a reset code"));
  }
}

export async function completePasswordReset(
  identifier: string,
  code: string,
  newPassword: string,
) {
  try {
    const response = await apiClient.post<AuthResponse>(
      "/auth/password-resets/complete",
      {
        account_type: "CUSTOMER",
        identifier,
        code,
        new_password: newPassword,
      },
    );
    return response.data;
  } catch (error) {
    throw new Error(getAuthError(error, "Unable to reset your password"));
  }
}

export async function requestEmailVerification() {
  const response = await apiClient.post<AuthResponse>(
    "/auth/email-verifications",
  );
  return response.data;
}

export async function verifyEmail(code: string) {
  const response = await apiClient.post<AuthResponse>(
    "/auth/email-verifications/confirm",
    { code },
  );
  return response.data;
}
