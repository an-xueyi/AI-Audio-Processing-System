/*
 * App is the top-level UI composition. Business state lives in
 * useAudioProcessing, while the child components receive only the information
 * and event handlers needed to render their own sections.
 */
import { DownloadResults } from "./components/DownloadResults";
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
    backendHealth,
    cancelJob,
    downloadUrls,
    isUploading,
    isCancelling,
    isJobHistoryLoading,
    job,
    jobHistory,
    message,
    selectedFile,
    sessionReady,
    selectFile,
    selectHistoryJob,
    startProcessing,
  } = useAudioProcessing();

  // main is the semantic container for the page's primary application content.
  return (
    <main className="app-shell">
      {/* Hero contains static product identity and does not require props. */}
      <Hero />

      {/* Pass current health and message state into the status presentation. */}
      <SystemStatus backendHealth={backendHealth} message={message} />

      {/* UploadPanel receives data to display plus callbacks for user actions. */}
      <UploadPanel
        isUploading={isUploading}
        message={message}
        selectedFile={selectedFile}
        sessionReady={sessionReady}
        onFileSelected={selectFile}
        onStartProcessing={startProcessing}
      />

      {/*
        The backend health information becomes available before job-history
        loading finishes. Showing the panel at that point lets the user see its
        loading message instead of making the whole section suddenly appear.
      */}
      {backendHealth && (
        <JobHistory
          isLoading={isJobHistoryLoading}
          jobs={jobHistory}
          selectedJobId={job?.id ?? null}
          onJobSelected={selectHistoryJob}
        />
      )}

      {/* `&&` conditionally renders job information only after a job exists. */}
      {/* The job value is known to be non-null inside this conditional branch. */}
      {job && (
        <JobDetails
          isCancelling={isCancelling}
          job={job}
          onCancel={cancelJob}
        />
      )}
      {/* Download links do not appear until the completed job returns them. */}
      {downloadUrls && <DownloadResults downloadUrls={downloadUrls} />}
    </main>
  );
}

export default App;
