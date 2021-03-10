import {ErrorHandler, RawRequest} from "./types";
import {formatArray, formatValidationError} from './utils';
import {OpenApi} from './openapi';
import {ErrorObject} from 'ajv';

function formatOperationName(request: RawRequest) {
  const {method, path} = request;

  return `${method.toUpperCase()} ${path}`;
}

export abstract class ApiError extends Error {
  protected constructor(readonly request: RawRequest, message?: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class BadRequestError extends ApiError {
  constructor(request: RawRequest, readonly errors: ErrorObject[]) {
    super(request, `Invalid request: ${formatArray(errors, formatValidationError)}`);
  }
}

export class NotFoundError extends ApiError {
  constructor(request: RawRequest) {
    super(request, `Unknown operation ${formatOperationName(request)}`);
  }
}

export class NotImplementedError extends ApiError {
  constructor(request: RawRequest) {
    super(request, `Operation ${formatOperationName(request)} not implemented`);
  }
}

export class UnauthorizedError extends ApiError {
  constructor(request: RawRequest, readonly errors: Error[]) {
    super(request, `Operation ${formatOperationName(request)} not authorized`);
  }
}

export class HttpError<Data extends Record<string, any> = any> extends Error {
  constructor(message: string, readonly statusCode: number, readonly data?: Data) {
    super(message);
  }
}

function toHttpError(err: Error, {logger}: OpenApi<unknown>): HttpError {
  if (err instanceof BadRequestError) {
    return new HttpError(`Invalid request`, 400, {
      errors: err.errors.map(({dataPath, message, keyword, params}) => ({
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
    let statusCode: number | undefined = undefined;

    const errors = err.errors.map(error => {
      const {message = `Authorization scheme failed`, statusCode: subStatusCode, data} = error as any;

      statusCode = statusCode ?? subStatusCode;

      return {message, data};
    });

    return new HttpError(`Not authorized`, statusCode ?? 401, {errors});
  }

  if (err instanceof HttpError) {
    return err as HttpError;
  }

  logger.error(`Unhandled internal error: `, err);

  return new HttpError(`Internal error`, 500);
}

export const defaultErrorHandler: ErrorHandler<any> = (req, res, params, err) => {
  const {statusCode = 500, message = 'Unknown error', data} = toHttpError(err, params.api);

  Object.assign(res, {statusCode, body: {message, data}});
};