import axios, { type AxiosRequestConfig } from "axios";

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? "/api",
});

let isRedirectingToLogin = false;

// Endpoints that legitimately answer 401 for *bad credentials* (not for an
// unauthenticated session). Intercepting those into a full-page redirect to
// /login would break the inline error handling on the login form and sign staff
// out when they mis-type the password on the sale-lock dialog.
const REDIRECT_EXEMPT_401 = new Set(["/auth/login", "/auth/verify"]);

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const url = err.config?.url ?? "";
    const isSessionExpired =
      err.response?.status === 401 &&
      url !== "/auth/logout" &&
      !REDIRECT_EXEMPT_401.has(url);
    if (isSessionExpired && !isRedirectingToLogin) {
      isRedirectingToLogin = true;
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
      return Promise.reject(err);
    }

    const config: AxiosRequestConfig & { _retryCount?: number } = err.config ?? {};
    const method = (config.method ?? "get").toUpperCase();
    const isIdempotent = ["GET", "HEAD", "OPTIONS", "PUT", "DELETE"].includes(method);
    const isRetryable =
      isIdempotent &&
      (!err.response ||
        (err.response.status >= 500 && err.response.status < 600) ||
        err.code === "ECONNABORTED" ||
        err.code === "ERR_NETWORK");

    if (isRetryable && config._retryCount == null) {
      config._retryCount = 0;
    }

    if (isRetryable && (config._retryCount ?? 0) < MAX_RETRIES) {
      config._retryCount = (config._retryCount ?? 0) + 1;
      const delay = BASE_DELAY_MS * Math.pow(2, config._retryCount - 1);
      await new Promise((r) => setTimeout(r, delay));
      return api(config);
    }

    return Promise.reject(err);
  }
);

export default api;
