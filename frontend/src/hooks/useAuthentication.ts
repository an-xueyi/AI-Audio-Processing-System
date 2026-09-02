/* Hold account identity and expose safe login, registration, and logout actions. */
import { useCallback, useState } from "react";
import {
  fetchCurrentUser,
  loginToAccount,
  logoutFromAccount,
  registerAccount,
} from "../api/authentication";
import {
  changeAccountPassword,
  deleteAccount as requestAccountDeletion,
  fetchAccountSessions,
  revokeOtherAccountSessions,
} from "../api/accountManagement";
import type { AccountSession, User } from "../types";

type AuthenticationAction = (
  credentials: { username: string; password: string },
) => Promise<User>;

export function useAuthentication() {
  // null represents a valid anonymous visitor after initialization completes.
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authenticationError, setAuthenticationError] = useState<string | null>(
    null,
  );
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [accountSessions, setAccountSessions] = useState<AccountSession[]>([]);
  const [accountManagementError, setAccountManagementError] = useState<
    string | null
  >(null);
  const [isManagingAccount, setIsManagingAccount] = useState(false);

  const loadAuthentication = useCallback(async () => {
    // This runs after the anonymous session cookie is established, allowing /me
    // to report either a restored account login or an anonymous visitor.
    const user = await fetchCurrentUser();
    setCurrentUser(user);
    return user;
  }, []);

  const runAuthentication = useCallback(
    async (
      action: AuthenticationAction,
      username: string,
      password: string,
    ): Promise<boolean> => {
      setAuthenticationError(null);
      setAccountManagementError(null);
      setIsAuthenticating(true);

      try {
        // Group both fields into the JSON-shaped object expected by the API layer.
        const user = await action({ username, password });
        setCurrentUser(user);
        setAccountSessions([]);
        return true;
      } catch (error) {
        setAuthenticationError(
          error instanceof Error ? error.message : "Authentication failed",
        );
        return false;
      } finally {
        setIsAuthenticating(false);
      }
    },
    [],
  );

  const login = useCallback(
    (username: string, password: string) =>
      runAuthentication(loginToAccount, username, password),
    [runAuthentication],
  );

  const register = useCallback(
    (username: string, password: string) =>
      runAuthentication(registerAccount, username, password),
    [runAuthentication],
  );

  const logout = useCallback(async (): Promise<boolean> => {
    setAuthenticationError(null);
    setAccountManagementError(null);
    setIsAuthenticating(true);

    try {
      await logoutFromAccount();
      // The anonymous cookie remains valid, so null means visitor mode, not an
      // unusable application session.
      setCurrentUser(null);
      setAccountSessions([]);
      return true;
    } catch (error) {
      setAuthenticationError(
        error instanceof Error ? error.message : "Could not sign out",
      );
      return false;
    } finally {
      setIsAuthenticating(false);
    }
  }, []);

  const loadAccountSessions = useCallback(async (): Promise<boolean> => {
    setAccountManagementError(null);
    setIsManagingAccount(true);

    try {
      setAccountSessions(await fetchAccountSessions());
      return true;
    } catch (error) {
      setAccountManagementError(
        error instanceof Error ? error.message : "Could not load sessions",
      );
      return false;
    } finally {
      setIsManagingAccount(false);
    }
  }, []);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<boolean> => {
      setAccountManagementError(null);
      setIsManagingAccount(true);

      try {
        await changeAccountPassword(currentPassword, newPassword);
        // Password changes revoke all other sessions, so replace the displayed
        // list with the one current browser session returned by the backend.
        setAccountSessions(await fetchAccountSessions());
        return true;
      } catch (error) {
        setAccountManagementError(
          error instanceof Error ? error.message : "Could not change password",
        );
        return false;
      } finally {
        setIsManagingAccount(false);
      }
    },
    [],
  );

  const revokeOtherSessions = useCallback(async (): Promise<boolean> => {
    setAccountManagementError(null);
    setIsManagingAccount(true);

    try {
      const result = await revokeOtherAccountSessions();
      setAccountSessions(result.sessions);
      return true;
    } catch (error) {
      setAccountManagementError(
        error instanceof Error
          ? error.message
          : "Could not sign out other browsers",
      );
      return false;
    } finally {
      setIsManagingAccount(false);
    }
  }, []);

  const deleteAccount = useCallback(async (password: string) => {
    setAccountManagementError(null);
    setIsManagingAccount(true);

    try {
      await requestAccountDeletion(password);
      // The backend leaves the anonymous ownership cookie in place, so the app
      // can immediately continue as a visitor after the account is removed.
      setCurrentUser(null);
      setAccountSessions([]);
      return true;
    } catch (error) {
      setAccountManagementError(
        error instanceof Error ? error.message : "Could not delete account",
      );
      return false;
    } finally {
      setIsManagingAccount(false);
    }
  }, []);

  return {
    accountManagementError,
    accountSessions,
    authenticationError,
    changePassword,
    currentUser,
    deleteAccount,
    isAuthenticating,
    isManagingAccount,
    loadAuthentication,
    loadAccountSessions,
    login,
    logout,
    register,
    revokeOtherSessions,
  };
}
