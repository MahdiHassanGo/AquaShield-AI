import { Router } from "express";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.get(
  "/",
  asyncHandler(async (_request, response) => {
    await prisma.$queryRaw`SELECT 1`;

    let modelService: unknown = { status: "unreachable" };
    try {
      const modelResponse = await fetch(`${env.ML_SERVICE_URL}/health`, {
        signal: AbortSignal.timeout(5_000)
      });
      modelService = await modelResponse.json();
    } catch {
      // Database/API can remain online while the inference service is restarting.
    }

    response.json({
      status: "ok",
      database: "connected",
      modelService,
      timestamp: new Date().toISOString()
    });
  })
);

export default router;
