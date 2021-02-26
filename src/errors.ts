import * as OpenAPI from "openapi-backend";
import * as Ajv from "ajv";

import {PendingRawResponse, RawRequest, RawResponse, Request, Response} from "./types";

function formatValidationError(error: Ajv.ErrorObject) {
  return `At '${error.dataPath}': ${Object.entries(error.params)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join(', ')}`;
}

function formatOperationName(request: OpenAPI.ParsedRequest) {
  const {method, path} = request;

  return `${method.toUpperCase()} ${path}`;
}

export abstract class ApiError extends Error {
  protected constructor(readonly context: OpenAPI.Context, message?: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ValidationFailError extends ApiError {
  constructor(context: OpenAPI.Context) {
    super(context, `Invalid request: ${JSON.stringify(context.validation.errors!.map(formatValidationError))}`);
  }
}

export class NotFoundError extends ApiError {
  constructor(context: OpenAPI.Context) {
    super(context, `Unknown operation ${formatOperationName(context.request)}`);
  }
}

export class NotImplementedError extends ApiError {
  constructor(context: OpenAPI.Context) {
    super(context, `Operation ${formatOperationName(context.request)} not implemented`);
  }
}

export class UnauthorizedError extends ApiError {
  constructor(context: OpenAPI.Context) {
    super(context, `Operation ${formatOperationName(context.request)} not authorized`);
  }
}

export class HttpError<Data extends Record<string, any> = any> extends Error {
  constructor(message: string, readonly statusCode: number, readonly data?: Data) {
    super(message);
  }
}

function toHttpError(err: Error): HttpError {
  if (err instanceof ValidationFailError) {
    const errors = err.context.validation.errors ?? [];

    console.warn(`Validation errors:`, errors);

    return new HttpError(`Invalid request`, 400, {
      errors: errors.map(data => ({
        message: `${data.dataPath} ${data.message}`,
        data
      }))
    });
  }

  if (err instanceof NotFoundError) {
    return new HttpError(`Resource not found`, 404);
  }

  if (err instanceof NotImplementedError) {
    return new HttpError(`Not implemented`, 501);
  }

  if (err instanceof UnauthorizedError) {
    const {authorized, ...results} = err.context.security;
    let statusCode: number | undefined;

    const errors = Object.entries(results)
        .filter(([, result]) => !result || result.error)
        .map(([scheme, result]) => {
          const {message = `Authorization scheme failed`, statusCode: subStatusCode, data} = result?.error || {};

          statusCode = statusCode ?? subStatusCode;

          return {message, scheme, data};
        });

    return new HttpError(`Not authorized`, statusCode ?? 401, {errors});
  }

  if (err instanceof HttpError) {
    return err as HttpError;
  }

  console.error(`Unhandled internal error: `, err);

  return new HttpError(`Internal error`, 500);
}

export function defaultErrorHandler<P>(
    req: RawRequest,
    res: PendingRawResponse,
    params: P,
    err: Error,
) {
  const {statusCode = 500, message = 'Unknown error', data} = toHttpError(err);

  Object.assign(res, {statusCode, body: {message, data}});
}