/**
 * ═══════════════════════════════════════════
 * OpinIA — Zod Validation Layer
 * ═══════════════════════════════════════════
 *
 * Central validation helper for all API routes.
 *
 * Usage (standalone):
 *   const [data, errorResponse] = await validateBody(request, MySchema);
 *   if (errorResponse) return errorResponse;
 *   // data is fully typed as z.infer<typeof MySchema>
 *
 * Usage (with withApiHandler):
 *   const [data, err] = await validateBody(request, MySchema);
 *   if (err) return err;
 *   // data is typed
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

/** Success: [data, null]. Failure: [null, NextResponse]. */
export type ValidationResult<T> = [T, null] | [null, NextResponse];

// ────────────────────────────────────────────
// Core: validateBody
// ────────────────────────────────────────────

/**
 * Parse request JSON and validate against a Zod schema.
 *
 * Returns a discriminated tuple:
 *   - Success: [typedData, null]
 *   - Failure: [null, NextResponse(400)]
 *
 * Handles:
 *   - Invalid/missing JSON body → 400
 *   - Zod validation errors → 400 with field-level details
 *   - Unexpected errors → 400 generic
 */
export async function validateBody<T extends z.ZodType>(
  request: Request,
  schema: T
): Promise<ValidationResult<z.infer<T>>> {
  let raw: unknown;

  // 1. Parse JSON
  try {
    raw = await request.json();
  } catch {
    return [
      null,
      NextResponse.json(
        {
          error: 'invalid_json',
          message: 'Request body is not valid JSON.',
        },
        { status: 400 }
      ),
    ];
  }

  // 2. Validate against schema
  const result = schema.safeParse(raw);

  if (!result.success) {
    const fieldErrors = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    }));

    return [
      null,
      NextResponse.json(
        {
          error: 'validation_error',
          message: 'Invalid request body.',
          details: fieldErrors,
        },
        { status: 400 }
      ),
    ];
  }

  return [result.data, null];
}

// ────────────────────────────────────────────
// Helpers: validateQuery (for GET params)
// ────────────────────────────────────────────

/**
 * Validate URL search params against a Zod schema.
 * Converts URLSearchParams to a plain object first.
 */
export function validateQuery<T extends z.ZodType>(
  request: Request,
  schema: T
): ValidationResult<z.infer<T>> {
  const url = new URL(request.url);
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  const result = schema.safeParse(params);

  if (!result.success) {
    const fieldErrors = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    }));

    return [
      null,
      NextResponse.json(
        {
          error: 'validation_error',
          message: 'Invalid query parameters.',
          details: fieldErrors,
        },
        { status: 400 }
      ),
    ];
  }

  return [result.data, null];
}

// ────────────────────────────────────────────
// Helpers: validateParams (for route params)
// ────────────────────────────────────────────

/**
 * Validate dynamic route params (e.g. Next.js `{ params }`) against a Zod schema.
 */
export function validateParams<T extends z.ZodType>(
  params: unknown,
  schema: T
): ValidationResult<z.infer<T>> {
  const result = schema.safeParse(params);

  if (!result.success) {
    const fieldErrors = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    }));

    return [
      null,
      NextResponse.json(
        {
          error: 'validation_error',
          message: 'Invalid request body.',
          details: fieldErrors,
        },
        { status: 400 }
      ),
    ];
  }

  return [result.data, null];
}
