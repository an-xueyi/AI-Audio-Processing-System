/* Send account requests while leaving HttpOnly cookie handling to the browser. */
import { API_BASE_URL } from "../config";
import type { AuthenticationResponse, User } from "../types";
import { getApiErrorMessage } from "./apiErrors";

type Credentials = {
  username: string;
  password: string;
};

async function submitCredentials(
  endpoint: "login" | "register",
  credentials: Credentials,
): Promise<User> {
  const response = await fetch(`${API_BASE_URL}/api/auth/${endpoint}`, {
    method: "POST",
    // include lets the browser send anonymous/auth cookies and accept the new
    // HttpOnly auth cookie. JavaScript never receives the cookie's token value.
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    // The password is sent in the HTTPS request body in production. The backend
    // hashes it immediately and never returns or logs it.
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    throw new Error(
      await getApiErrorMessage(response, `Could not ${endpoint}`),
    );
  }

  const data = (await response.json()) as AuthenticationResponse;

  if (!data.authenticated) {
    throw new Error("The backend did not create an authenticated session");
  }

  return data.user;
}

export async function fetchCurrentUser(): Promise<User | null> {
  // /me does not receive a user ID from JavaScript. The backend derives identity
  // exclusively from verified cookies and returns only safe public account data.
  const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(
      await getApiErrorMessage(response, "Could not check account status"),
    );
  }

  const data = (await response.json()) as AuthenticationResponse;
  return data.authenticated ? data.user : null;
}

export function registerAccount(credentials: Credentials): Promise<User> {
  return submitCredentials("register", credentials);
}

export function loginToAccount(credentials: Credentials): Promise<User> {
  return submitCredentials("login", credentials);
}

export async function logoutFromAccount(): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, "Could not sign out"));
  }
}
