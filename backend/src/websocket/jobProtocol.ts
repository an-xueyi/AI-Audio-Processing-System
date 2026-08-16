import { z } from "zod";

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
