/* Static heading that identifies the application and summarizes its workflow. */
export function Hero() {
  return (
    <section className="hero-section">
      <p className="eyebrow">Distributed AI Audio Processing System</p>
      <h1>Upload audio. Track processing. Download separated stems.</h1>
      <p className="hero-copy">
        A full-stack audio processing pipeline using React, Express,
        PostgreSQL, MinIO, Kafka, WebSockets, and a Python worker.
      </p>
    </section>
  );
}
