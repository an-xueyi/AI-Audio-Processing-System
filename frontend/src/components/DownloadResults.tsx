/* Keep completed stems on the page as playable audio with optional downloads. */
import { formatStemName, orderStemEntries } from "../utils/stems";

type DownloadResultsProps = {
  // The object may contain different names when a different Demucs model is used.
  downloadUrls: Record<string, string>;
};

export function DownloadResults({ downloadUrls }: DownloadResultsProps) {
  // Present familiar musical stems first instead of relying on object or upload
  // order. Unknown stems still appear afterward, so another model remains usable.
  const orderedStems = orderStemEntries(downloadUrls);

  return (
    <section className="panel">
      <div className="section-header">
        <h2>Separated Results</h2>
      </div>

      <ul className="stem-results-list">
        {orderedStems.map(([stemName, url]) => {
          // Storage uses lowercase machine names; the interface displays labels
          // such as "Vocals" and "Piano" for people reading the page.
          const displayName = formatStemName(stemName);

          return (
            <li className="stem-result" key={stemName}>
              <div className="stem-result-header">
                <h3>{displayName}</h3>
                {/* `download` asks the browser to save the temporary URL instead
                    of navigating away. The audio player remains the main action. */}
                <a
                  className="stem-download-link"
                  href={url}
                  download={`${stemName}.wav`}
                >
                  Download WAV
                </a>
              </div>

              {/* preload="metadata" reads only enough data to show duration until
                  the user presses Play, avoiding six immediate full downloads. */}
              <audio className="stem-audio-player" controls preload="metadata">
                <source src={url} type="audio/wav" />
                {/* This fallback is visible only in a browser without audio support. */}
                <a href={url}>Download {displayName}</a>
              </audio>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
