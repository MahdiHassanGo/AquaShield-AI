import multer from "multer";
import { env } from "../config/env.js";

const acceptedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: env.MAX_IMAGE_BYTES
  },
  fileFilter: (_request, file, callback) => {
    if (!acceptedMimeTypes.has(file.mimetype)) {
      callback(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "image"));
      return;
    }
    callback(null, true);
  }
});
