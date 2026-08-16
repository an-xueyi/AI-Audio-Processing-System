const fallbackAudioContentTypes: Record<string, string> = {
  aac: "audio/aac",
  flac: "audio/flac",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
};

export function getAudioContentType(file: File): string {
  if (file.type) {
    return file.type;
  }

  const extension = file.name.toLowerCase().split(".").pop();
  return extension ? fallbackAudioContentTypes[extension] || "" : "";
}
