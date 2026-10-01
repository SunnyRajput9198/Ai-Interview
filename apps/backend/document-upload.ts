import multer from "multer";
import path from "node:path";
import type { RequestHandler } from "express";
import { MAX_DOCUMENT_SIZE_MB } from "./config";

const allowedMimeTypes = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => callback(null, "uploads/"),
  filename: (_request, file, callback) => {
    const unique = `${Date.now()}-${crypto.randomUUID()}`;
    callback(null, `${unique}${path.extname(file.originalname)}`);
  },
});

export const documentUpload = multer({
  storage,
  limits: { fileSize: MAX_DOCUMENT_SIZE_MB * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    if (allowedMimeTypes.has(file.mimetype)) {
      callback(null, true);
    } else {
      callback(new Error("Unsupported file type. Allowed: pdf, txt, md, docx"));
    }
  },
});

export const handleDocumentUpload: RequestHandler = (
  request,
  response,
  next,
) => {
  documentUpload.single("file")(request, response, (error?: unknown) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError) {
      response
        .status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400)
        .json({ error: error.message });
      return;
    }

    if (error instanceof Error) {
      response.status(400).json({ error: error.message });
      return;
    }

    next(error);
  });
};
