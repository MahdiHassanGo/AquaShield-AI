import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { allowedOrigins } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import authRoutes from "./routes/auth.routes.js";
import healthRoutes from "./routes/health.routes.js";
import predictionRoutes from "./routes/prediction.routes.js";

export const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      
      // Allow local development
      if (origin.includes("localhost") || origin.includes("127.0.0.1")) {
        callback(null, true);
        return;
      }

      // Clean trailing slash
      const cleanOrigin = origin.trim().replace(/\/$/, "");

      // Allow if present in allowedOrigins environment variable list
      if (allowedOrigins.includes(cleanOrigin)) {
        callback(null, true);
        return;
      }

      // Auto-allow all Vercel deployments (production & preview subdomains)
      try {
        const parsedUrl = new URL(origin);
        if (parsedUrl.hostname.endsWith(".vercel.app")) {
          callback(null, true);
          return;
        }
      } catch (err) {
        // Invalid URL origin format
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS.`));
    },
    credentials: false
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 200,
    standardHeaders: "draft-8",
    legacyHeaders: false
  })
);

app.get("/", (_request, response) => {
  response.json({
    name: "Shrimp Disease Classification API",
    version: "1.0.0",
    health: "/api/health"
  });
});
app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/predictions", predictionRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
