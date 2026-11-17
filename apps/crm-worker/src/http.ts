import type { ErrorCode } from "@saas/contracts/errors";

export function successResponse<T>(data: T, requestId: string, status = 200): Response {
  return Response.json(
    { data, meta: { requestId, cursor: null } },
    { status, headers: { "content-type": "application/json" } },
  );
}

export function errorResponse(
  code: ErrorCode | string,
  message: string,
  status: number,
  requestId: string,
  details?: Record<string, unknown>,
): Response {
  return Response.json(
    { error: { code, message, details: details ?? {}, requestId } },
    { status, headers: { "content-type": "application/json" } },
  );
}

/** Another org's record, an unknown record and an unknown route all read the
 *  same: nothing here. Never 403 for a record the caller's org does not own. */
export function notFound(requestId: string): Response {
  return errorResponse("not_found", "Not found", 404, requestId);
}

export function methodNotAllowed(requestId: string): Response {
  return errorResponse("unsupported", "Method not allowed", 405, requestId);
}

export function forbidden(requestId: string): Response {
  return errorResponse("forbidden", "You do not have permission to do this", 403, requestId);
}

export function validationError(requestId: string, fields: Record<string, string[]>): Response {
  return errorResponse("validation_failed", "Validation failed", 422, requestId, { fields });
}
