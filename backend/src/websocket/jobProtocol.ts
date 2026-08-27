/* Runtime validation for messages sent from the browser over a WebSocket. */
import { z } from "zod";

// A discriminated union first reads `type`, then applies the matching object's
// rules. `strict()` rejects unexpected fields instead of silently ignoring them.
export const clientMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("subscribe"),
      jobId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      type: z.literal("unsubscribe"),
    })
    .strict(),
]);
