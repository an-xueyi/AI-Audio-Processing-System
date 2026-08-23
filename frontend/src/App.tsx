import { DownloadResults } from "./components/DownloadResults";
import { Hero } from "./components/Hero";
import { JobDetails } from "./components/JobDetails";
import { SystemStatus } from "./components/SystemStatus";
import { UploadPanel } from "./components/UploadPanel";
import { useAudioProcessing } from "./hooks/useAudioProcessing";

function App() {
  const {
    backendHealth,
    cancelJob,
    downloadUrls,
    isUploading,
    isCancelling,
    job,
    message,
    selectedFile,
    sessionReady,
    selectFile,
    startProcessing,
  } = useAudioProcessing();

  return (
    <main className="app-shell">
      <Hero />

      <SystemStatus backendHealth={backendHealth} message={message} />

      <UploadPanel
        isUploading={isUploading}
        message={message}
        selectedFile={selectedFile}
        sessionReady={sessionReady}
        onFileSelected={selectFile}
        onStartProcessing={startProcessing}
      />

      {job && (
        <JobDetails
          isCancelling={isCancelling}
          job={job}
          onCancel={cancelJob}
        />
      )}
      {downloadUrls && <DownloadResults downloadUrls={downloadUrls} />}
    </main>
  );
}

export default App;
