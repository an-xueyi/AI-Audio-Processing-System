/* Present file selection and the command that starts the upload workflow. */
type UploadPanelProps = {
  // Props are values and callback functions supplied by the parent App.
  isUploading: boolean;
  message: string;
  selectedFile: File | null;
  sessionReady: boolean;
  onFileSelected: (file: File | null) => void;
  onStartProcessing: () => void;
};

export function UploadPanel({
  isUploading,
  message,
  selectedFile,
  sessionReady,
  onFileSelected,
  onStartProcessing,
}: UploadPanelProps) {
  return (
    <section className="panel">
      <div className="section-header">
        <h2>Upload Audio</h2>
      </div>

      {/* accept filters the browser picker but is not a security validation rule. */}
      <input
        className="file-input"
        type="file"
        accept="audio/*"
        onChange={(event) => {
          // files is a FileList. Optional chaining handles a cleared input, and
          // ?? null converts the missing first file to the hook's expected value.
          onFileSelected(event.target.files?.[0] ?? null);
        }}
      />

      {/* Disable the command during duplicate submissions and before a secure
          browser session exists. */}
      <button
        className="primary-button"
        type="button"
        onClick={onStartProcessing}
        disabled={!selectedFile || isUploading || !sessionReady}
      >
        {isUploading ? "Uploading..." : "Upload and Create Job"}
      </button>

      <p className="message">{message}</p>
    </section>
  );
}
