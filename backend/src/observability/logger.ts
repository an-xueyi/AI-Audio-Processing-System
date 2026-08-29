/* Write machine-readable JSON logs with consistent service and error fields. */
import { getRequestContext } from "./requestContext.js";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const serviceName = process.env.SERVICE_NAME || "backend";
const instanceId = process.env.HOSTNAME || `local-${process.pid}`;

function serializeError(error: unknown) {
  if (error instanceof Error) {
    // Stack traces stay in server logs and are never returned in HTTP responses.
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  // JavaScript permits throwing non-Error values; String makes them loggable.
  return { message: String(error) };
}

export function writeLog(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
) {
  const requestId = getRequestContext()?.requestId;
  const { error, ...remainingFields } = fields;

  /*
   * Keep fixed observability fields at the top level so command-line tools and
   * future log systems can filter by level, service, event, instance, or request.
   * User-provided values cannot overwrite these fixed fields because they are
   * assigned after remainingFields.
   */
  const logRecord = {
    ...remainingFields,
    timestamp: new Date().toISOString(),
    level,
    service: serviceName,
    instanceId,
    event,
    ...(requestId ? { requestId } : {}),
    ...(error === undefined ? {} : { error: serializeError(error) }),
  };

  const serializedRecord = `${JSON.stringify(logRecord)}\n`;

  // Error and warning records use stderr; routine information uses stdout.
  if (level === "error" || level === "warn") {
    process.stderr.write(serializedRecord);
  } else {
    process.stdout.write(serializedRecord);
  }
}

export const logger = {
  // `fields || {}` turns an omitted third argument into an empty object. This
  // keeps every convenience method compatible with writeLog's object parameter.
  debug: (event: string, fields?: LogFields) =>
    writeLog("debug", event, fields || {}),
  info: (event: string, fields?: LogFields) =>
    writeLog("info", event, fields || {}),
  warn: (event: string, fields?: LogFields) =>
    writeLog("warn", event, fields || {}),
  error: (event: string, fields?: LogFields) =>
    writeLog("error", event, fields || {}),
};
