type DownloadResultsProps = {
  downloadUrls: Record<string, string>;
};

export function DownloadResults({ downloadUrls }: DownloadResultsProps) {
  return (
    <section className="panel">
      <div className="section-header">
        <h2>Download Results</h2>
      </div>

      <ul className="download-list">
        {Object.entries(downloadUrls).map(([stemName, url]) => (
          <li key={stemName}>
            <a href={url} target="_blank" rel="noreferrer">
              Download {stemName}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
