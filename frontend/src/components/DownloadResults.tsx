/* Render one temporary result link for each stem returned by the backend. */
type DownloadResultsProps = {
  // The object may contain different names when a different Demucs model is used.
  downloadUrls: Record<string, string>;
};

export function DownloadResults({ downloadUrls }: DownloadResultsProps) {
  return (
    <section className="panel">
      <div className="section-header">
        <h2>Download Results</h2>
      </div>

      <ul className="download-list">
        {/* Object.entries supports any stem names produced by the chosen model.
            React uses each stemName key to identify its item across rerenders. */}
        {Object.entries(downloadUrls).map(([stemName, url]) => (
          <li key={stemName}>
            {/* noreferrer prevents the opened page from receiving this page's URL. */}
            {/* target opens the temporary object URL in another browser tab. */}
            <a href={url} target="_blank" rel="noreferrer">
              Download {stemName}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
