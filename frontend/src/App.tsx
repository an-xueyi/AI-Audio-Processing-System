/*
 * App is the top-level UI composition. Business state lives in
 * useAudioProcessing, while the child components receive only the information
 * and event handlers needed to render their own sections.
 */
import { DownloadResults } from "./components/DownloadResults";
import { AccountPanel } from "./components/AccountPanel";
import { Hero } from "./components/Hero";
import { JobDetails } from "./components/JobDetails";
import { JobHistory } from "./components/JobHistory";
import { SystemStatus } from "./components/SystemStatus";
import { UploadPanel } from "./components/UploadPanel";
import { useAudioProcessing } from "./hooks/useAudioProcessing";

function App() {
  // Destructuring gives local names to the state and actions returned by the
  // custom hook without exposing the hook's internal implementation to the UI.
  const {
    accountManagementError,
    accountSessions,
    authenticationError,
    backendHealth,
    cancelJob,
    changePassword,
    currentUser,
    deleteAccount,
    downloadUrls,
    isAuthenticating,
    isCancelling,
    isJobHistoryLoading,
    isManagingAccount,
    isUploading,
    job,
    jobHistory,
    login,
    loadAccountSessions,
    logout,
    message,
    register,
    revokeOtherSessions,
    selectedFile,
    sessionReady,
    selectFile,
    selectHistoryJob,
    startProcessing,
    workerAvailability,
  } = useAudioProcessing();

  // main is the semantic container for the page's primary application content.
  return (
    <main className="app-shell">
      {/* Hero contains static product identity and does not require props. */}
      <Hero />

      {/* Account actions change the server-resolved owner used by later calls. */}
      <AccountPanel
        accountManagementError={accountManagementError}
        accountSessions={accountSessions}
        authenticationError={authenticationError}
        currentUser={currentUser}
        identityChangeDisabled={isUploading || !sessionReady}
        isAuthenticating={isAuthenticating}
        isManagingAccount={isManagingAccount}
        onChangePassword={changePassword}
        onDeleteAccount={deleteAccount}
        onLogin={login}
        onLoadSessions={loadAccountSessions}
        onLogout={logout}
        onRegister={register}
        onRevokeOtherSessions={revokeOtherSessions}
      />

      {/* Pass current health and message state into the status presentation. */}
      <SystemStatus
        backendHealth={backendHealth}
        message={message}
        workerAvailability={workerAvailability}
      />

      {/* UploadPanel receives data to display plus callbacks for user actions. */}
      <UploadPanel
        isUploading={isUploading}
        message={message}
        selectedFile={selectedFile}
        sessionReady={sessionReady}
        onFileSelected={selectFile}
        onStartProcessing={startProcessing}
      />

      {/* `&&` conditionally renders job information only after a job exists. */}
      {/* The job value is known to be non-null inside this conditional branch. */}
      {job && (
        <JobDetails
          isCancelling={isCancelling}
          job={job}
          onCancel={cancelJob}
        />
      )}
      {/* Playable stems belong directly below the selected job that created them. */}
      {downloadUrls && <DownloadResults downloadUrls={downloadUrls} />}

      {/*
        History follows the current job and its results. This keeps the primary
        workflow in reading order: upload, current processing state, playable
        output, and then older jobs that the user may choose to reopen.
      */}
      {backendHealth && (
        <JobHistory
          isLoading={isJobHistoryLoading}
          jobs={jobHistory}
          selectedJobId={job?.id ?? null}
          onJobSelected={selectHistoryJob}
        />
      )}
    </main>
  );
}

export default App;
