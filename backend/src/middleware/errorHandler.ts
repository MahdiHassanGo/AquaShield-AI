import { Prisma } from "@prisma/client";
import type { ErrorRequestHandler, RequestHandler } from "express";
import multer from "multer";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export const notFoundHandler: RequestHandler = (request, response) => {
  response.status(404).json({
    message: `Route ${request.method} ${request.originalUrl} was not found.`
  });
};

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof AppError) {
    response.status(error.statusCode).json({ message: error.message, details: error.details });
    return;
  }

  if (error instanceof ZodError) {
    response.status(400).json({
      message: "Request validation failed.",
      issues: error.flatten()
    });
    return;
  }

  if (error instanceof multer.MulterError) {
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? "The image is too large."
        : "Only one valid JPEG, PNG or WebP image is accepted.";
    response.status(400).json({ message, code: error.code });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      response.status(409).json({ message: "A record with that unique value already exists." });
      return;
    }
  }

  console.error(error);
  response.status(500).json({ message: "An unexpected server error occurred." });
};
