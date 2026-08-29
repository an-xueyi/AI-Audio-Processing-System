/* Preserve one request ID across asynchronous work started by an HTTP request. */
import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  requestId: string;
};

/*
 * AsyncLocalStorage behaves like request-local memory. Node carries the current
 * value through promises and callbacks, so deeply called services can add the
 * request ID to logs without receiving it through every function parameter.
 */
const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(
  context: RequestContext,
  callback: () => T,
): T {
  // run makes context available only while callback and its async descendants run.
  return requestContextStorage.run(context, callback);
}

export function getRequestContext(): RequestContext | undefined {
  // undefined is expected for startup, Kafka, cleanup, and shutdown logs because
  // those operations did not begin from an HTTP request.
  return requestContextStorage.getStore();
}

