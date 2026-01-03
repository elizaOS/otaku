import {
  validateUuid,
  logger,
  getContentTypeFromMimeType,
  getUploadsAgentsDir,
} from '@elizaos/core';
import express from 'express';
import { sendError, sendSuccess } from '../shared/response-utils';
import { ALLOWED_MEDIA_MIME_TYPES, MAX_FILE_SIZE } from '../shared/constants';
import { requireAuth, createUploadRateLimit, type AuthenticatedRequest } from '../../middleware';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Rate limiter for upload operations
const uploadRateLimiter = createUploadRateLimit();

// Configure multer for file uploads - initial filter on claimed MIME type
// Actual content validation happens after upload using magic bytes
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    // Initial check on claimed MIME type - actual validation happens later
    if (ALLOWED_MEDIA_MIME_TYPES.includes(file.mimetype as any)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  },
});

/**
 * Magic bytes signatures for file type detection
 * Used to validate actual file content, not trust client-provided MIME type
 */
const MAGIC_BYTES: { [key: string]: { bytes: number[]; offset?: number; extension: string } } = {
  // Images
  'image/jpeg': { bytes: [0xFF, 0xD8, 0xFF], extension: '.jpg' },
  'image/png': { bytes: [0x89, 0x50, 0x4E, 0x47], extension: '.png' },
  'image/gif': { bytes: [0x47, 0x49, 0x46, 0x38], extension: '.gif' },
  'image/webp': { bytes: [0x52, 0x49, 0x46, 0x46], extension: '.webp' }, // RIFF header
  // Video
  'video/mp4': { bytes: [0x66, 0x74, 0x79, 0x70], offset: 4, extension: '.mp4' }, // ftyp at offset 4
  'video/webm': { bytes: [0x1A, 0x45, 0xDF, 0xA3], extension: '.webm' },
  // Audio
  'audio/mpeg': { bytes: [0xFF, 0xFB], extension: '.mp3' }, // MP3 frame sync
  'audio/mp3': { bytes: [0x49, 0x44, 0x33], extension: '.mp3' }, // ID3 tag
  'audio/wav': { bytes: [0x52, 0x49, 0x46, 0x46], extension: '.wav' }, // RIFF header
  'audio/ogg': { bytes: [0x4F, 0x67, 0x67, 0x53], extension: '.ogg' },
  'audio/flac': { bytes: [0x66, 0x4C, 0x61, 0x43], extension: '.flac' },
  // Documents
  'application/pdf': { bytes: [0x25, 0x50, 0x44, 0x46], extension: '.pdf' },
};

/**
 * Detect file type from magic bytes
 * Returns the detected MIME type and safe extension, or null if unknown/dangerous
 */
function detectFileType(buffer: Buffer): { mimeType: string; extension: string } | null {
  for (const [mimeType, signature] of Object.entries(MAGIC_BYTES)) {
    const offset = signature.offset || 0;
    const bytes = signature.bytes;
    
    if (buffer.length < offset + bytes.length) {
      continue;
    }
    
    let matches = true;
    for (let i = 0; i < bytes.length; i++) {
      if (buffer[offset + i] !== bytes[i]) {
        matches = false;
        break;
      }
    }
    
    if (matches) {
      return { mimeType, extension: signature.extension };
    }
  }
  
  // Check for text/plain - must be valid UTF-8 and not contain HTML/script tags
  const textSample = buffer.slice(0, Math.min(1024, buffer.length)).toString('utf8');
  const lowerText = textSample.toLowerCase();
  
  // Reject anything that looks like HTML or has script tags
  if (lowerText.includes('<html') || 
      lowerText.includes('<script') || 
      lowerText.includes('<!doctype') ||
      lowerText.includes('<body') ||
      lowerText.includes('<head') ||
      lowerText.includes('javascript:')) {
    logger.warn('[MEDIA UPLOAD] Rejected file: contains HTML/script content');
    return null;
  }
  
  // Allow plain text if it doesn't contain dangerous content
  // Check if it's valid UTF-8 by looking for replacement characters
  if (!textSample.includes('\uFFFD') && buffer.length < 1024 * 1024) { // Only allow small text files
    return { mimeType: 'text/plain', extension: '.txt' };
  }
  
  return null;
}

/**
 * Sanitize filename - remove path traversal and dangerous characters
 */
function sanitizeFilename(originalName: string): string {
  // Remove path components
  const basename = path.basename(originalName);
  // Remove dangerous characters, keep only alphanumeric, dash, underscore, dot
  return basename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
}

// Helper function to save uploaded file with security checks
async function saveUploadedFile(
  file: Express.Multer.File,
  agentId: string,
  userId: string
): Promise<{ filename: string; url: string; detectedType: string }> {
  // Detect actual file type from content, not from client-provided MIME type
  const detected = detectFileType(file.buffer);
  
  if (!detected) {
    throw new Error('File type could not be verified or is not allowed');
  }
  
  // Verify detected type is in allowed list
  if (!ALLOWED_MEDIA_MIME_TYPES.includes(detected.mimeType as any)) {
    throw new Error(`Detected file type ${detected.mimeType} is not allowed`);
  }
  
  const uploadDir = path.join(getUploadsAgentsDir(), agentId);

  // Ensure directory exists
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  // Generate cryptographically random filename with safe extension
  const randomBytes = crypto.randomBytes(16).toString('hex');
  const timestamp = Date.now();
  // Use the extension determined by magic byte detection, NOT from original filename
  const filename = `${timestamp}-${randomBytes}${detected.extension}`;
  const filePath = path.join(uploadDir, filename);

  // Write file to disk
  fs.writeFileSync(filePath, file.buffer);
  
  logger.info(`[MEDIA UPLOAD] User ${userId.substring(0, 8)}... uploaded file: ${filename} (detected: ${detected.mimeType})`);

  const url = `/media/uploads/agents/${agentId}/${filename}`;
  return { filename, url, detectedType: detected.mimeType };
}

/**
 * Agent media upload functionality
 * 
 * Security:
 * - Requires authentication
 * - Rate limited per IP
 * - Validates file content using magic bytes (not MIME type header)
 * - Generates random filenames with safe extensions
 * - Blocks HTML/script content
 */
export function createAgentMediaRouter(): express.Router {
  const router = express.Router();

  /**
   * Media upload endpoint for images, videos, audio, and documents
   * POST /api/media/agents/:agentId/upload-media
   * 
   * Security: Requires authentication, validates file content, rate limited
   */
  router.post(
    '/:agentId/upload-media',
    requireAuth,
    uploadRateLimiter,
    upload.single('file'),
    async (req: AuthenticatedRequest, res) => {
      logger.debug('[MEDIA UPLOAD] Processing media upload with multer');

      const agentId = validateUuid(req.params.agentId);
      if (!agentId) {
        return sendError(res, 400, 'INVALID_ID', 'Invalid agent ID format');
      }

      if (!req.file) {
        return sendError(res, 400, 'INVALID_REQUEST', 'No media file provided');
      }

      // Get authenticated user ID
      const userId = req.userId;
      if (!userId) {
        return sendError(res, 401, 'UNAUTHORIZED', 'User ID not found in request');
      }

      try {
        // Save the uploaded file with content validation
        const result = await saveUploadedFile(req.file, agentId, userId);

        const mediaType = getContentTypeFromMimeType(result.detectedType);

        logger.info(
          `[MEDIA UPLOAD] Successfully uploaded ${mediaType}: ${result.filename}. URL: ${result.url}`
        );

        sendSuccess(res, {
          url: result.url,
          type: mediaType,
          filename: result.filename,
          originalName: sanitizeFilename(req.file.originalname),
          size: req.file.size,
          detectedMimeType: result.detectedType,
        });
      } catch (error) {
        logger.error(`[MEDIA UPLOAD] Error processing upload: ${error}`);
        
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // Return specific error for file type validation failures
        if (errorMessage.includes('could not be verified') || errorMessage.includes('not allowed')) {
          return sendError(
            res,
            400,
            'INVALID_FILE_TYPE',
            errorMessage
          );
        }
        
        sendError(
          res,
          500,
          'UPLOAD_ERROR',
          'Failed to process media upload',
          errorMessage
        );
      }
    }
  );

  return router;
}
