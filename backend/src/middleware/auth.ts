import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config/env.js";

const tokenPayloadSchema = z.object({
  sub: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(["USER", "ADMIN"])
});

export function requireAuth(request: Request, response: Response, next: NextFunction): void {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    response.status(401).json({ message: "Authentication is required." });
    return;
  }

  const token = authorization.slice("Bearer ".length).trim();
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    const payload = tokenPayloadSchema.parse(decoded);
    request.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role
    };
    next();
  } catch {
    response.status(401).json({ message: "The access token is invalid or expired." });
  }
}
