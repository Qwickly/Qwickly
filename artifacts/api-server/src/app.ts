import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
app.set("etag", false);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// CORS: allow specific frontend origins (credentials mode requires an explicit origin, not *)
// Set ALLOWED_ORIGINS in Railway backend env vars to add more (comma-separated).
// The Railway frontend domain is always included as a built-in fallback.
const BUILT_IN_ORIGINS = [
  "https://airy-nurturing-production-398a.up.railway.app",
  "http://localhost:3000",
  "http://localhost:5173",
];
const extraOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
  : [];
const allowedOrigins = new Set([...BUILT_IN_ORIGINS, ...extraOrigins]);

app.use(
  cors({
    origin(origin, callback) {
      // Allow requests with no origin (curl, Postman, server-to-server)
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin)) return callback(null, true);
      callback(new Error(`CORS: origin not allowed — ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Centralized error handler: convert auth-related errors to 401
// so missing/invalid tokens don't produce 500 responses.
app.use((err: unknown, _req, res, _next) => {
  try {
    const message = err && typeof err === "object" && "message" in err ? (err as any).message : String(err);
    if (typeof message === "string" && (message.includes("Unauthorized") || message.includes("Missing authorization token"))) {
      return res.status(401).json({ error: message });
    }
  } catch {
    // ignore
  }

  // Fallback to generic 500
  // eslint-disable-next-line no-console
  console.error(err);
  return res.status(500).json({ error: "Internal Server Error" });
});

export default app;
