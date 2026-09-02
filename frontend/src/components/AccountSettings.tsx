/* Render signed-in account controls without exposing cookie or token values. */
import { useState, type FormEvent } from "react";
import type { AccountSession } from "../types";

type AccountSettingsProps = {
  error: string | null;
  isBusy: boolean;
  sessions: AccountSession[];
  username: string;
  onChangePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<boolean>;
  onClose: () => void;
  onDeleteAccount: (password: string) => Promise<boolean>;
  onRevokeOtherSessions: () => Promise<boolean>;
};

function formatSessionTime(value: string): string {
  // The backend sends an ISO timestamp. Intl uses the browser's local timezone
  // and familiar date/time format without changing the stored server value.
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function AccountSettings({
  error,
  isBusy,
  sessions,
  username,
  onChangePassword,
  onClose,
  onDeleteAccount,
  onRevokeOtherSessions,
}: AccountSettingsProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmedPassword, setConfirmedPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  // The current session cannot be revoked through the "other browsers" command.
  const otherSessionCount = sessions.filter(
    (session) => !session.isCurrent,
  ).length;

  async function submitPasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    setLocalMessage(null);

    if (newPassword !== confirmedPassword) {
      setLocalError("The two new passwords do not match.");
      return;
    }

    const succeeded = await onChangePassword(currentPassword, newPassword);

    // Password values are removed from React state after every server attempt.
    setCurrentPassword("");
    setNewPassword("");
    setConfirmedPassword("");

    if (succeeded) {
      setLocalMessage(
        "Password changed. Other browsers have been signed out.",
      );
    }
  }

  async function revokeOtherSessions() {
    setLocalError(null);
    setLocalMessage(null);

    if (await onRevokeOtherSessions()) {
      setLocalMessage("Other browser sessions were signed out.");
    }
  }

  async function submitAccountDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    setLocalMessage(null);

    if (deleteConfirmation !== username) {
      setLocalError(`Type ${username} exactly to confirm account deletion.`);
      return;
    }

    const succeeded = await onDeleteAccount(deletePassword);
    setDeletePassword("");

    if (!succeeded) {
      return;
    }

    // Success changes the parent to visitor mode, which unmounts this component.
    setDeleteConfirmation("");
  }

  return (
    <section className="panel account-settings" aria-labelledby="settings-heading">
      <div className="section-header">
        <div>
          <h2 id="settings-heading">Account settings</h2>
          <p className="account-settings-intro">
            Manage this password and the browsers currently signed in.
          </p>
        </div>
        <button className="secondary-button" type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <section className="account-settings-section" aria-labelledby="sessions-heading">
        <div className="account-settings-title-row">
          <h3 id="sessions-heading">Active sessions</h3>
          <button
            className="secondary-button"
            type="button"
            disabled={isBusy || otherSessionCount === 0}
            onClick={() => void revokeOtherSessions()}
          >
            Sign out other browsers
          </button>
        </div>

        {sessions.length === 0 ? (
          <p className="account-muted">
            {isBusy ? "Loading active sessions..." : "No sessions were returned."}
          </p>
        ) : (
          <ul className="account-session-list">
            {sessions.map((session) => (
              <li key={session.id}>
                <strong>
                  {session.isCurrent ? "Current browser" : "Other browser"}
                </strong>
                <span>Started {formatSessionTime(session.createdAt)}</span>
                <span>Last active {formatSessionTime(session.lastSeenAt)}</span>
                <span>Expires {formatSessionTime(session.expiresAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="account-settings-section" aria-labelledby="password-heading">
        <h3 id="password-heading">Change password</h3>
        <form className="settings-form" onSubmit={submitPasswordChange}>
          <label>
            <span>Current password</span>
            <input
              type="password"
              autoComplete="current-password"
              minLength={12}
              maxLength={128}
              required
              disabled={isBusy}
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <label>
            <span>New password</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
              disabled={isBusy}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>
          <label>
            <span>Confirm new password</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
              disabled={isBusy}
              value={confirmedPassword}
              onChange={(event) => setConfirmedPassword(event.target.value)}
            />
          </label>
          <button className="primary-button" type="submit" disabled={isBusy}>
            {isBusy ? "Please wait..." : "Change password"}
          </button>
        </form>
      </section>

      <section
        className="account-settings-section account-danger"
        aria-labelledby="delete-heading"
      >
        <h3 id="delete-heading">Delete account</h3>
        <p>
          This cancels active processing and permanently removes private audio,
          job history, login sessions, and the account.
        </p>
        <form className="settings-form delete-account-form" onSubmit={submitAccountDeletion}>
          <label>
            <span>Type {username} to confirm</span>
            <input
              type="text"
              autoComplete="off"
              required
              disabled={isBusy}
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
            />
          </label>
          <label>
            <span>Current password</span>
            <input
              type="password"
              autoComplete="current-password"
              minLength={12}
              maxLength={128}
              required
              disabled={isBusy}
              value={deletePassword}
              onChange={(event) => setDeletePassword(event.target.value)}
            />
          </label>
          <button
            className="danger-button"
            type="submit"
            disabled={isBusy || deleteConfirmation !== username}
          >
            Delete account permanently
          </button>
        </form>
      </section>

      {(localError || error) && (
        <p className="message error" role="alert">
          {localError || error}
        </p>
      )}
      {localMessage && (
        <p className="message account-success" role="status">
          {localMessage}
        </p>
      )}
    </section>
  );
}
