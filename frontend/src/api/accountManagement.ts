/* Send authenticated account-management requests through small named functions. */
import { API_BASE_URL } from "../config";
import type {
  AccountSession,
  AccountSessionsResponse,
  RevokeSessionsResponse,
} from "../types";
import { getApiErrorMessage } from "./apiErrors";

export async function fetchAccountSessions(): Promise<AccountSession[]> {
  const response = await fetch(`${API_BASE_URL}/api/auth/sessions`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(
      await getApiErrorMessage(response, "Could not load active sessions"),
    );
  }

  const data = (await response.json()) as AccountSessionsResponse;
  return data.sessions;
}

export async function revokeOtherAccountSessions(): Promise<
  RevokeSessionsResponse
> {
  const response = await fetch(
    `${API_BASE_URL}/api/auth/sessions/revoke-others`,
    {
      method: "POST",
      credentials: "include",
    },
  );

  if (!response.ok) {
    throw new Error(
      await getApiErrorMessage(response, "Could not sign out other browsers"),
    );
  }

  return (await response.json()) as RevokeSessionsResponse;
}

export async function changeAccountPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/auth/password`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    // Passwords exist in this request body only long enough to travel to the
    // backend over HTTPS in production. They are not stored by the frontend.
    body: JSON.stringify({ currentPassword, newPassword }),
  });

  if (!response.ok) {
    throw new Error(
      await getApiErrorMessage(response, "Could not change the password"),
    );
  }
}

export async function deleteAccount(password: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/auth/account`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
  });

  if (!response.ok) {
    throw new Error(
      await getApiErrorMessage(response, "Could not delete the account"),
    );
  }
}
