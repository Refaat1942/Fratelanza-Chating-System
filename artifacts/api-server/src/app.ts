import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
// host nginx -> web (nginx) container -> api: trust both hops so req.ip is the real client.
app.set("trust proxy", 2);

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
// Bumped from default 100kb so branding logo data-URLs (up to ~700KB
// after base64 encoding) can be saved via PUT /api/settings.
// `verify` keeps the untouched request bytes: Meta's X-Hub-Signature-256 is an
// HMAC of the raw body, so it cannot be checked against re-serialised JSON.
app.use(
  express.json({
    limit: "2mb",
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

app.use("/api", router);

// In production, serve the built lotus-crm SPA from the same process so the
// deployment exposes a single port. The build copies dist/public into the
// api-server's working tree at deploy time via the build pipeline.
const spaDir = path.resolve(process.cwd(), "artifacts/lotus-crm/dist/public");
if (fs.existsSync(spaDir)) {
  app.use(express.static(spaDir));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(spaDir, "index.html"));
  });
}

export default app;
