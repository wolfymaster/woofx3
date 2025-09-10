import {defineConfig, env, loadEnv} from "@axonotes/axogen";
import * as z from "zod";

const envVars = loadEnv(
    z.object({
        APPLICATION_ID: z.string(),
        WOLFYTTV_DATABASE_URL: z.string(),
        DATABASE_PROXY_PORT: z.coerce.number().default(3000),
        DATABASE_PROXY_URL: z.string(),
    })
);

export default defineConfig({
    targets: {
        app: env({
            path: "db/.env",
            variables: {
                APPLICATION_ID: envVars.APPLICATION_ID,
                DATABASE_URL: envVars.WOLFYTTV_DATABASE_URL,
                DATABASE_PROXY_PORT: envVars.DATABASE_PROXY_PORT,
                DATABASE_PROXY_URL: envVars.DATABASE_PROXY_URL,
            },
        }),
    },
});