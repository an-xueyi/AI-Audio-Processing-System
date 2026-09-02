/* Hold account identity and expose safe login, registration, and logout actions. */
import { useCallback, useState } from "react";
import {
  fetchCurrentUser,
  loginToAccount,
  logoutFromAccount,
  registerAccount,
} from "../api/authentication";
import type { User } from "../types";

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
      setIsAuthenticating(true);

      try {
        // Group both fields into the JSON-shaped object expected by the API layer.
        const user = await action({ username, password });
        setCurrentUser(user);
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
    setIsAuthenticating(true);

    try {
      await logoutFromAccount();
      // The anonymous cookie remains valid, so null means visitor mode, not an
      // unusable application session.
      setCurrentUser(null);
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

  return {
    authenticationError,
    currentUser,
    isAuthenticating,
    loadAuthentication,
    login,
    logout,
    register,
  };
}
