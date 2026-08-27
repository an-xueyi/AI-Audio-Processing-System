/* Determine the MIME content type sent in the signed upload request. */
const fallbackAudioContentTypes: Record<string, string> = {
  // Each property maps a lowercase extension to its standard HTTP MIME value.
  aac: "audio/aac",
  flac: "audio/flac",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
};

export function getAudioContentType(file: File): string {
  // Browsers usually provide File.type, but some files or operating systems do
  // not. The extension map is a fallback, not a security check; the backend
  // independently validates the uploaded object before creating a job.
  if (file.type) {
    return file.type;
  }

  // Convert the name to lowercase, split at every period, and take the last part.
  const extension = file.name.toLowerCase().split(".").pop();

  // Return the mapped type when both extension and mapping exist; otherwise use
  // an empty string so the calling validation guard can reject the selection.
  return extension ? fallbackAudioContentTypes[extension] || "" : "";
}
