import express from 'express';
import { sendError } from '../shared/response-utils';

/**
 * Creates the media router - FILE UPLOADS DISABLED FOR SECURITY
 * 
 * All upload functionality has been disabled pending security review.
 */
export function mediaRouter(): express.Router {
  const router = express.Router();

  // SECURITY: All uploads disabled - reject any upload attempts
  router.all('{*path}', (_req, res) => {
    return sendError(res, 403, 'UPLOADS_DISABLED', 'File uploads are currently disabled for security reasons');
  });

  return router;
}
