import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import { uploadImage } from "../middleware/upload.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

const mlResponseSchema = z.object({
  className: z.enum(["Healthy", "BG", "WSSV", "BG_WSSV"]),
  confidence: z.number().min(0).max(1),
  confidencePercentage: z.number(),
  isLowConfidence: z.boolean(),
  probabilities: z.record(z.number()),
  modelName: z.string(),
  modelVersion: z.string(),
  ensembleSize: z.number().int().positive(),
  disclaimer: z.string()
});

const idSchema = z.string().uuid();

async function classifyImage(file: Express.Multer.File) {
  const formData = new FormData();
  formData.append(
    "image",
    new Blob([Uint8Array.from(file.buffer)], { type: file.mimetype }),
    file.originalname
  );

  let modelResponse: globalThis.Response;
  try {
    modelResponse = await fetch(`${env.ML_SERVICE_URL}/predict`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(60_000)
    });
  } catch (error) {
    throw new AppError(503, "The machine-learning service is unavailable.", String(error));
  }

  const payload: unknown = await modelResponse.json().catch(() => ({}));
  if (!modelResponse.ok) {
    const detail =
      typeof payload === "object" && payload !== null && "detail" in payload
        ? String((payload as { detail: unknown }).detail)
        : "Model inference failed.";
    throw new AppError(modelResponse.status, detail);
  }

  return mlResponseSchema.parse(payload);
}

router.use(requireAuth);

router.post(
  "/",
  uploadImage.single("image"),
  asyncHandler(async (request, response) => {
    if (!request.file) {
      throw new AppError(400, "Attach an image using the field name 'image'.");
    }

    const result = await classifyImage(request.file);
    const prediction = await prisma.prediction.create({
      data: {
        originalFileName: request.file.originalname,
        mimeType: request.file.mimetype,
        fileSize: request.file.size,
        predictedClass: result.className,
        confidence: result.confidence,
        probabilities: result.probabilities,
        modelName: result.modelName,
        modelVersion: result.modelVersion,
        ensembleSize: result.ensembleSize,
        lowConfidence: result.isLowConfidence,
        userId: request.user!.id
      }
    });

    response.status(201).json({
      prediction,
      confidencePercentage: result.confidencePercentage,
      disclaimer: result.disclaimer
    });
  })
);

router.get(
  "/stats/summary",
  asyncHandler(async (request, response) => {
    const groups = await prisma.prediction.groupBy({
      by: ["predictedClass"],
      where: { userId: request.user!.id },
      _count: { _all: true },
      _avg: { confidence: true }
    });
    const total = await prisma.prediction.count({ where: { userId: request.user!.id } });
    response.json({ total, classes: groups });
  })
);

router.get(
  "/",
  asyncHandler(async (request, response) => {
    const page = Math.max(1, Number(request.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(request.query.limit) || 20));
    const where = { userId: request.user!.id };

    const [items, total] = await Promise.all([
      prisma.prediction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.prediction.count({ where })
    ]);

    response.json({
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  })
);

router.get(
  "/:id",
  asyncHandler(async (request, response) => {
    const id = idSchema.parse(request.params.id);
    const prediction = await prisma.prediction.findFirst({
      where: { id, userId: request.user!.id }
    });
    if (!prediction) {
      throw new AppError(404, "Prediction was not found.");
    }
    response.json({ prediction });
  })
);

router.delete(
  "/:id",
  asyncHandler(async (request, response) => {
    const id = idSchema.parse(request.params.id);
    const existing = await prisma.prediction.findFirst({
      where: { id, userId: request.user!.id },
      select: { id: true }
    });
    if (!existing) {
      throw new AppError(404, "Prediction was not found.");
    }
    await prisma.prediction.delete({ where: { id } });
    response.status(204).send();
  })
);

export default router;
