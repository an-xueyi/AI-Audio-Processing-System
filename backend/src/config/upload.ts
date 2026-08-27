/* Upload policy shared by the presign route and post-upload verification. */
const defaultMaxUploadBytes = 250 * 1024 * 1024;

// Environment variables are strings. Number converts the configured text so it
// can be checked and compared with the byte length reported by object storage.
const configuredMaxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES);

export const maxUploadBytes =
  // Accept only a positive safe integer. The ternary uses the configured value
  // when valid and the 250 MiB default otherwise.
  Number.isSafeInteger(configuredMaxUploadBytes) && configuredMaxUploadBytes > 0
    ? configuredMaxUploadBytes
    : defaultMaxUploadBytes;

// MIME types describe the file content in HTTP and object metadata. Variants such
// as audio/wav and audio/x-wav are both included because browsers differ.
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

// Extensions provide a separate filename check; they do not replace MIME or
// stored-object validation.
export const allowedAudioExtensions = new Set([
  "aac",
  "flac",
  "m4a",
  "mp3",
  "ogg",
  "wav",
]);

export function hasAllowedAudioExtension(fileName: string): boolean {
  // `pop()` returns the text after the final period. Lowercasing allows both
  // song.MP3 and song.mp3 without duplicating entries in the allowed Set.
  const extension = fileName.toLowerCase().split(".").pop();
  return extension !== undefined && allowedAudioExtensions.has(extension);
}
