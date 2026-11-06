import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import { config } from "./config.js";
import authRoutes from "./routes/auth.js";
import operations from "./routes/operations.js";
import collections from "./routes/collections.js";
import publicRoutes from "./routes/public.js";
import onboardingRoutes from "./routes/onboarding.js";
const app = express();
app.disable("x-powered-by");
app.use(helmet());

const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests without an Origin header
      // (e.g. server-to-server requests)
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.error("CORS blocked origin:", origin);

      return callback(new Error("CORS origin not allowed"));
    },

    credentials: true,

    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

    allowedHeaders: ["Content-Type", "Authorization"],

    optionsSuccessStatus: 204,
  }),
);

app.use(express.json({ limit: "256kb" }));
app.use(cookieParser());
if (!config.production) app.use(morgan("dev"));
app.use(
  "/api/v1/auth",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  }),
  authRoutes,
);
app.get("/api/v1/health", (req, res) =>
  res.json({
    status: mongoose.connection.readyState === 1 ? "ok" : "degraded",
    database:
      mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    time: new Date().toISOString(),
  }),
);
app.use("/api/v1", publicRoutes);
// New registration and invitation workflows
app.use("/api/v1", onboardingRoutes);
app.use("/api/v1", operations);
app.use("/api/v1", collections);
app.use((req, res) =>
  res.status(404).json({ message: "API endpoint not found" }),
);
app.use((err, req, res, next) => {
  const status =
    err.status ||
    (err.name === "ValidationError" || err.name === "CastError" ? 400 : 500);
  if (status >= 500) console.error("[API]", err);
  res.status(status).json({
    message: status === 500 ? "Internal server error" : err.message,
    code: err.code || (status === 500 ? "SERVER_ERROR" : "REQUEST_ERROR"),
  });
});
export default app;
