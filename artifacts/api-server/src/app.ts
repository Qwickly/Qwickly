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
app.use(cors());
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
