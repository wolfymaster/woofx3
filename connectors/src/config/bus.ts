import { z } from "zod";

/** The message bus and db-proxy the host connects to. */
export const BusEnvSchema = z.object({
  woofx3MessagebusUrl: z.string().min(1, "woofx3MessagebusUrl is required"),
  woofx3MessagebusJwt: z.string().optional(),
  woofx3MessagebusNKey: z.string().optional(),
  // loadRuntimeEnv coerces an all-digit value to a number.
  woofx3MessagebusToken: z.union([z.string(), z.number()]).optional(),
  woofx3DatabaseProxyUrl: z.url("woofx3DatabaseProxyUrl must be a URL"),
});

export type BusEnv = z.infer<typeof BusEnvSchema>;

export interface BusConfig {
  url: string;
  jwt?: string;
  nkeySeed?: string;
  /** Blank when the bus takes no token. */
  token: string;
}

export function busConfig(env: BusEnv): BusConfig {
  return {
    url: env.woofx3MessagebusUrl,
    jwt: nonBlank(env.woofx3MessagebusJwt),
    nkeySeed: nonBlank(env.woofx3MessagebusNKey),
    token: nonBlank(env.woofx3MessagebusToken) ?? "",
  };
}

function nonBlank(value: string | number | undefined): string | undefined {
  const text = value === undefined ? "" : String(value).trim();
  return text === "" ? undefined : text;
}
