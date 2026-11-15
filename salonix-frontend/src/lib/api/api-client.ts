import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import type { AuthResponse } from "@/features/auth/types";
import { clearAccessToken, getAccessToken, setAccessToken } from "@/lib/auth/access-token";
import { publicEnv } from "@/lib/env";

export const apiClient = axios.create({
  baseURL: publicEnv.NEXT_PUBLIC_API_URL,
  timeout: publicEnv.NEXT_PUBLIC_API_REQUEST_TIMEOUT_MS,
  withCredentials: true,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
  },
});

const retriedRequests = new WeakSet<InternalAxiosRequestConfig>();
const noRefreshPaths = [
  "/auth/login",
  "/auth/google",
  "/auth/register",
  "/auth/refresh",
  "/auth/logout",
  "/auth/phone-verifications/confirm",
];
let refreshRequest: Promise<string> | null = null;

function isRefreshExcluded(url: string | undefined) {
  const path = url?.split("?")[0];
  return noRefreshPaths.some((excludedPath) => path?.endsWith(excludedPath));
}

export function refreshAccessToken(failedAccessToken: string | null = getAccessToken()): Promise<string> {
  if (!refreshRequest) {
    const refresh = async () => {
      const currentAccessToken = getAccessToken();
      if (currentAccessToken && currentAccessToken !== failedAccessToken) {
        return currentAccessToken;
      }

      const response = await apiClient.post<AuthResponse>("/auth/refresh");
      const token = response.data.data?.token;
      if (!token) throw new Error("Refresh response did not contain an access token");
      setAccessToken(token);
      return token;
    };

    const refreshWithLock = () => {
      if (typeof navigator !== "undefined" && navigator.locks) {
        return navigator.locks.request("salonix-auth-refresh", refresh);
      }
      return refresh();
    };

    refreshRequest = refreshWithLock()
      .catch((error: unknown) => {
        clearAccessToken();
        throw error;
      })
      .finally(() => {
        refreshRequest = null;
      });
  }
  return refreshRequest;
}

function redirectToLogin() {
  if (typeof window === "undefined") return;
  const path = window.location.pathname;
  if (!path.startsWith("/dashboard") && !path.startsWith("/verify-email")) return;
  const next = `${path}${window.location.search}`;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!(error instanceof AxiosError) || error.response?.status !== 401) {
      return Promise.reject(error);
    }

    const originalRequest = error.config;
    if (
      !originalRequest ||
      retriedRequests.has(originalRequest) ||
      isRefreshExcluded(originalRequest.url)
    ) {
      return Promise.reject(error);
    }

    retriedRequests.add(originalRequest);
    const currentAccessToken = getAccessToken();
    if (
      currentAccessToken &&
      originalRequest.headers.Authorization !== `Bearer ${currentAccessToken}`
    ) {
      originalRequest.headers.Authorization = `Bearer ${currentAccessToken}`;
      return apiClient(originalRequest);
    }

    try {
      const token = await refreshAccessToken(currentAccessToken);
      originalRequest.headers.Authorization = `Bearer ${token}`;
      return await apiClient(originalRequest);
    } catch {
      clearAccessToken();
      redirectToLogin();
      return Promise.reject(error);
    }
  },
);
