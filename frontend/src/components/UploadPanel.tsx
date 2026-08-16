type UploadPanelProps = {
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

      <input
        className="file-input"
        type="file"
        accept="audio/*"
        onChange={(event) => {
          onFileSelected(event.target.files?.[0] ?? null);
        }}
      />

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
