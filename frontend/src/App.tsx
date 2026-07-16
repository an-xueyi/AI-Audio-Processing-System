import {useEffect, useState} from 'react';

type HealthResponse = {
  status: string;
  service: string;
};

function App() {
  const [backendHealth, setBackendHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    async function checkBackendHealth() {
      try {
        const response = await fetch("http://localhost:4000/health");

        if (!response.ok) {
          throw new Error("Backend health check failed");
        }

        const data = (await response.json()) as HealthResponse;
        setBackendHealth(data);
      } catch (error) {
        setError("Could not connect to backend");
      }
    }

    checkBackendHealth();
  }, []);

  return (
    <main>
      <h1>Backend Health Check</h1>

      <section>
        <h2>Backend Status</h2>

        {backendHealth ? (
          <p>
            Backend is connected: {backendHealth.service} is{" "} {backendHealth.status}
          </p>) : (
          <p>{error || "Checking backend..."}</p>
        )}
      </section>
    </main>
  );
}

export default App;