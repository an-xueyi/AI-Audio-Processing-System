/* Present account controls while keeping password form state local to this file. */
import { useState, type FormEvent } from "react";
import type { AccountSession, User } from "../types";
import { AccountSettings } from "./AccountSettings";

type AccountPanelProps = {
  accountManagementError: string | null;
  accountSessions: AccountSession[];
  authenticationError: string | null;
  currentUser: User | null;
  identityChangeDisabled: boolean;
  isAuthenticating: boolean;
  isManagingAccount: boolean;
  onChangePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<boolean>;
  onDeleteAccount: (password: string) => Promise<boolean>;
  onLoadSessions: () => Promise<boolean>;
  onLogin: (username: string, password: string) => Promise<boolean>;
  onLogout: () => Promise<boolean>;
  onRegister: (username: string, password: string) => Promise<boolean>;
  onRevokeOtherSessions: () => Promise<boolean>;
};

type AccountMode = "login" | "register";

export function AccountPanel({
  accountManagementError,
  accountSessions,
  authenticationError,
  currentUser,
  identityChangeDisabled,
  isAuthenticating,
  isManagingAccount,
  onChangePassword,
  onDeleteAccount,
  onLoadSessions,
  onLogin,
  onLogout,
  onRegister,
  onRevokeOtherSessions,
}: AccountPanelProps) {
  // These values exist only while this form component is mounted. They are not
  // written to localStorage, a URL, application logs, or the job database.
  const [mode, setMode] = useState<AccountMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmedPassword, setConfirmedPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  function changeMode(nextMode: AccountMode) {
    setMode(nextMode);
    // Clear password fields when changing form purpose so a password typed for
    // one action is not unexpectedly reused by the other action.
    setPassword("");
    setConfirmedPassword("");
    setFormError(null);
  }

  async function toggleSettings() {
    const nextOpenState = !settingsOpen;
    setSettingsOpen(nextOpenState);

    if (nextOpenState) {
      // Fetch only when the user opens settings so ordinary page loads avoid a
      // network request for information that may never be displayed.
      await onLoadSessions();
    }
  }

  async function signOut() {
    if (await onLogout()) {
      setSettingsOpen(false);
    }
  }

  async function deleteAccount(passwordToVerify: string) {
    const succeeded = await onDeleteAccount(passwordToVerify);

    if (succeeded) {
      setSettingsOpen(false);
    }

    return succeeded;
  }

  async function submitAccountForm(event: FormEvent<HTMLFormElement>) {
    // A form normally reloads the page. Preventing that lets React submit with
    // fetch while preserving the current upload and job interface.
    event.preventDefault();
    setFormError(null);

    if (mode === "register" && password !== confirmedPassword) {
      setFormError("The two passwords do not match.");
      return;
    }

    // Choose the backend operation from the visible segmented-control mode.
    const succeeded =
      mode === "login"
        ? await onLogin(username, password)
        : await onRegister(username, password);

    // Remove password text from React state after every attempt. The user name
    // may remain because it is not a secret and helps correct a failed attempt.
    setPassword("");
    setConfirmedPassword("");

    if (succeeded) {
      setFormError(null);
    }
  }

  if (currentUser) {
    return (
      <>
        <section className="account-bar" aria-label="Account">
          <div>
            <span className="account-label">Signed in</span>
            <strong>{currentUser.username}</strong>
          </div>
          <div className="account-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={isAuthenticating || identityChangeDisabled}
              aria-expanded={settingsOpen}
              onClick={() => void toggleSettings()}
            >
              {settingsOpen ? "Hide settings" : "Manage account"}
            </button>
            <button
              className="secondary-button account-action"
              type="button"
              disabled={isAuthenticating || identityChangeDisabled}
              onClick={() => void signOut()}
            >
              {isAuthenticating ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </section>

        {settingsOpen && (
          <AccountSettings
            error={accountManagementError}
            isBusy={isManagingAccount}
            sessions={accountSessions}
            username={currentUser.username}
            onChangePassword={onChangePassword}
            onClose={() => setSettingsOpen(false)}
            onDeleteAccount={deleteAccount}
            onRevokeOtherSessions={onRevokeOtherSessions}
          />
        )}
      </>
    );
  }

  return (
    <section className="panel account-panel" aria-labelledby="account-heading">
      <div className="account-heading-row">
        <div>
          <h2 id="account-heading">Your account</h2>
          <p>
            Sign in to keep job history available across browsers. You can also
            continue without an account on this device.
          </p>
        </div>

        <div className="account-mode" aria-label="Account action">
          <button
            className={mode === "login" ? "active" : ""}
            type="button"
            aria-pressed={mode === "login"}
            onClick={() => changeMode("login")}
          >
            Sign in
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            type="button"
            aria-pressed={mode === "register"}
            onClick={() => changeMode("register")}
          >
            Create account
          </button>
        </div>
      </div>

      <form className="account-form" onSubmit={submitAccountForm}>
        <label>
          <span>Username</span>
          <input
            name="username"
            type="text"
            autoComplete="username"
            minLength={3}
            maxLength={30}
            pattern="[A-Za-z0-9_]+"
            required
            disabled={isAuthenticating || identityChangeDisabled}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>

        <label>
          <span>Password</span>
          <input
            name="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={12}
            maxLength={128}
            required
            disabled={isAuthenticating || identityChangeDisabled}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {mode === "register" && (
          <label>
            <span>Confirm password</span>
            <input
              name="confirmedPassword"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
              disabled={isAuthenticating || identityChangeDisabled}
              value={confirmedPassword}
              onChange={(event) => setConfirmedPassword(event.target.value)}
            />
          </label>
        )}

        <button
          className="primary-button account-submit"
          type="submit"
          disabled={isAuthenticating || identityChangeDisabled}
        >
          {isAuthenticating
            ? "Please wait..."
            : mode === "login"
              ? "Sign in"
              : "Create account"}
        </button>
      </form>

      {mode === "register" && (
        <p className="account-requirement">
          Use 3-30 letters, numbers, or underscores for the username and at least
          12 characters for the password.
        </p>
      )}

      {(formError || authenticationError) && (
        <p className="message error" role="alert">
          {formError || authenticationError}
        </p>
      )}

      {identityChangeDisabled && (
        <p className="account-requirement">
          Finish the current direct upload before changing accounts.
        </p>
      )}
    </section>
  );
}
