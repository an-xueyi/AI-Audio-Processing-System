const defaultMaxUploadBytes = 250 * 1024 * 1024;

const configuredMaxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES);

export const maxUploadBytes =
  Number.isSafeInteger(configuredMaxUploadBytes) && configuredMaxUploadBytes > 0
    ? configuredMaxUploadBytes
    : defaultMaxUploadBytes;

export const allowedAudioContentTypes = new Set([
  "audio/aac",
  "audio/flac",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/x-flac",
  "audio/x-m4a",
  "audio/x-wav",
]);

export const allowedAudioExtensions = new Set([
  "aac",
  "flac",
  "m4a",
  "mp3",
  "ogg",
  "wav",
]);

export function hasAllowedAudioExtension(fileName: string): boolean {
  const extension = fileName.toLowerCase().split(".").pop();
  return extension !== undefined && allowedAudioExtensions.has(extension);
}

