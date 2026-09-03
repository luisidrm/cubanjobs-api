import { config } from "dotenv";

// Must run before any test file imports a queries module — db/client.ts,
// src/lib/stripe.ts, and src/lib/minio.ts all read process.env and
// construct real singleton clients at import time.
config({ path: ".env.test" });
