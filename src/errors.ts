import * as OpenAPI from "openapi-backend";

import {ErrorHandler} from "./types";
import {formatArray, formatValidationError} from './utils';
import {OpenApi} from './openapi';

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

export class BadRequestError extends ApiError {
  constructor(context: OpenAPI.Context) {
    super(context, `Invalid request: ${formatArray(context.validation.errors!, formatValidationError)}`);
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

function toHttpError(err: Error, {logger}: OpenApi<unknown, unknown>): HttpError {
  if (err instanceof BadRequestError) {
    const errors = err.context.validation.errors ?? [];

    return new HttpError(`Invalid request`, 400, {
      errors: errors.map(({dataPath, message, keyword, params}) => ({
        message: `${dataPath || 'Request'} ${message}`,
        data: {keyword, dataPath, params}
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
    let statusCode: number | undefined = undefined;

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

  logger.error(`Unhandled internal error: `, err);

  return new HttpError(`Internal error`, 500);
}

export const defaultErrorHandler: ErrorHandler = (req, res, params, err) => {
  const {statusCode = 500, message = 'Unknown error', data} = toHttpError(err, params.api);

  Object.assign(res, {statusCode, body: {message, data}});
};