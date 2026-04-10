import { z } from "zod";

export const FaultSchema = z.object({
    Fault: z.object({
        Error: z.array(z.object({
            Message: z.string(),
            Detail: z.string().optional(),
            code: z.string(),
            element: z.string().optional()
        })),
        type: z.string()
    }),
    time: z.string().optional()
});
export type Fault = z.infer<typeof FaultSchema>;

export const TokenRefreshResponseSchema = z.object({
    access_token: z.string(),
    refresh_token: z.string(),
    expires_in: z.number(),
    x_refresh_token_expires_in: z.number(),
    token_type: z.string()
});
export type TokenRefreshResponse = z.infer<typeof TokenRefreshResponseSchema>;
