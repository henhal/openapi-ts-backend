import {ErrorObject} from 'ajv';
import * as OpenAPI from 'openapi-backend';
import {ValidationContext} from 'openapi-backend';

import * as Errors from './errors';
import {
  ApiContext,
  Authorizer,
  Awaitable,
  ErrorHandler,
  Interceptor,
  OperationHandler,
  OperationParams,
  Params,
  RawRequest,
  RawResponse,
  RegistrationParams,
  Request,
  RequestParams,
  Response,
  StringParams,
} from './types';
import {
  formatArray,
  formatValidationError,
  getParameterMap,
  getParametersSchema,
  inRange,
  mapObject,
  matchSchema,
  oneOrMany,
  ParameterType,
} from './utils';
import {createLogger, getLogLevels, Logger} from './logger';
import {OpenAPIV3} from 'openapi-types';

type FailStrategy = 'warn' | 'throw';
type ResponseTrimming = 'none' | 'failing' | 'all';

type HandlerData<P> = {
  res: Response;
  params: RequestParams<P>;
};

// Note: Implementation of OpenAPI.Handler - these arguments match the call to api.handleRequest
type OpenApiHandler<P, R> = (apiContext: OpenAPI.Context, data: HandlerData<P>) => Awaitable<R>;

export type ApiOptions = Pick<OpenAPI.Options, 'ajvOpts' | 'customizeAjv'>;

const LOG_LEVELS = getLogLevels(process.env.LOG_LEVEL ?? 'info');

const nop = () => {};
const consoleLogger: Logger = createLogger(level => LOG_LEVELS.includes(level) ?
    console[level].bind(null, `${level}:`) :
    nop);
const noLogger: Logger = createLogger(level => nop);

const defaultHandlers: Partial<OpenAPI.Options['handlers']> = Object.freeze({
  validationFail(apiContext) {
    throw new Errors.BadRequestError(apiContext.request, apiContext.validation.errors!);
  },
  notFound(apiContext) {
    throw new Errors.NotFoundError(apiContext.request);
  },
  notImplemented(apiContext) {
    throw new Errors.NotImplementedError(apiContext.request);
  }
});

function isRawRequest(req: any): req is RawRequest {
  return typeof req.method === 'string' &&
      typeof req.path === 'string' &&
      req.headers && typeof req.headers === 'object';
}

function getDefaultStatusCode({responses = {}}: OpenAPI.Operation): number {
  // If statusCode is not set and there is exactly one successful response, we use it automatically.
  const codes = Object.keys(responses || {}).map(Number).filter(inRange(200, 400));

  if (codes.length !== 1) {
    // No statusCode given and it's impossible to determine a default one from the response schemas
    throw new Error(`Cannot determine implicit status code from API definition response codes ${
        JSON.stringify(codes)}`);
  }
  return codes[0];
}

/**
 * A HTTP API using an OpenAPI definition.
 * This uses the openapi-backend module to parse, route and validate requests created from events.
 *
 * @template T     Type of custom data passed to each request's params
 *
 */
export class OpenApi<T> {
  private readonly apiOptions: Partial<OpenAPI.Options>;
  private interceptors: Interceptor<T>[] = [];
  private apiPromises: Promise<OpenAPI.OpenAPIBackend>[] = [];
  private readonly errorHandlerAsync: ErrorHandler<T>;
  readonly logger: Logger;
  readonly invalidResponseStrategy: FailStrategy;
  readonly responseTrimming: ResponseTrimming;

  /**
   * Constructor
   * @param params Parameters
   * @param [params.apiOptions] Options passed to the OpenAPIBackend instance.
   * @param [params.errorHandlerAsync] A function creating a response from an error thrown by the API.
   * @param [params.logger] A logger, or null to suppress all logging
   */
  constructor(
      {
        apiOptions = {},
        errorHandlerAsync = Errors.defaultErrorHandler,
        logger = consoleLogger,
        invalidResponseStrategy = 'warn',
        responseTrimming = 'failing'
      }: {
        apiOptions?: ApiOptions;
        errorHandlerAsync?: ErrorHandler<T>;
        logger?: Logger | null;
        invalidResponseStrategy?: FailStrategy;
        responseTrimming?: ResponseTrimming;
      } = {}) {
    this.apiOptions = {
      handlers: {...defaultHandlers}, // must copy
      ...apiOptions,
      customizeAjv: (ajv, ajvOpts, validationContext) => {
        if (validationContext === ValidationContext.Response) {
          // Remove additional properties on response body only
          ajv._opts.removeAdditional = this.responseTrimming === 'none' ? false : this.responseTrimming;
        }
        // Invoke custom function as well if applicable
        return apiOptions.customizeAjv ?
            apiOptions.customizeAjv(ajv, ajvOpts, validationContext) :
            ajv;
      },
    };
    this.errorHandlerAsync = errorHandlerAsync;
    this.logger = logger || noLogger;
    this.invalidResponseStrategy = invalidResponseStrategy;
    this.responseTrimming = responseTrimming;
  }

  private getApisAsync(): Promise<Array<OpenAPI.OpenAPIBackend>> {
    return Promise.all(this.apiPromises);
  }

  private async createApiAsync(apiOptions: OpenAPI.Options,
                               operations: Record<string, OperationHandler<T>>,
                               authorizers: Record<string, Authorizer<T>> = {}) {
    const api = await new OpenAPI.OpenAPIBackend(apiOptions).init();

    for (const [id, handler] of Object.entries(operations)) {
      api.registerHandler(id, this.createHandler(handler, id, authorizers));
    }

    return api;
  }

  protected parseParams(rawParams: StringParams, operation: OpenAPI.Operation, type: ParameterType, errors: ErrorObject[]): Params {
    // This is mostly used to coerce types, which openapi-backend does internally but then throws away
    return matchSchema<StringParams, Params>(
        rawParams,
        getParametersSchema(getParameterMap(operation, type)),
        errors);
  }

  protected parseRequest(apiContext: OpenAPI.Context): Request {
    const {request: {method, path, params, headers, query, body}, operation} = apiContext;
    const errors: ErrorObject[] = [];

    const req = {
      method,
      path,
      params: this.parseParams(params, operation, 'path', errors),
      headers: this.parseParams(headers, operation, 'header', errors),
      query: this.parseParams(query, operation, 'query', errors),
      body
    };

    // This will throw 500 since validation should have already been performed and this is only for coercion
    this.handleValidationErrors(errors, `Request doesn't match schema`, 'throw');

    return req;
  }

  protected formatResponse(res: Response): RawResponse {
    const {statusCode = 500, headers, body} = res;

    return {
      statusCode,
      headers: mapObject(headers, oneOrMany(String)),
      body,
    };
  }

  private async authorizeRequest(
      apiContext: ApiContext,
      req: Request,
      res: Response,
      operationParams: OperationParams<T>,
      authorizers: Record<string, Authorizer<T>>
  ) {
    const {api: {definition}, operation} = apiContext;
    const securityRequirements = operation.security ?? definition.security ?? [];

    if (securityRequirements.length === 0) {
      return {};
    }

    const errors: Error[] = [];

    // Handle authorization here instead of using security handlers, to enable passing scopes and solve
    // issue with conflicting security schemes across requirements.
    for (const securityRequirement of securityRequirements) {
      const results: Record<string, any> = {};
      let authorized = true;

      for (const [name, scopes] of Object.entries(securityRequirement)) {
        try {
          results[name] = await authorizers[name](req, res, operationParams, {
            name,
            scheme: definition.components?.securitySchemes?.[name] as OpenAPIV3.SecuritySchemeObject,
            parameters: {scopes}
          });
        } catch (error) {
          authorized = false;
          errors.push(error);
        }
      }

      if (authorized) {
        return results;
      }
    }

    throw new Errors.UnauthorizedError(apiContext.request, errors);
  }

  private createHandler(
      operationHandler: OperationHandler<T>,
      operationId: string,
      authorizers: Record<string, Authorizer<T>>): OpenApiHandler<T, void> {
    return async (apiContext, {res, params}) => {
      const {api: {definition}, operation} = apiContext;
      const req: Request = this.parseRequest(apiContext);
      const operationParams: OperationParams<T> = {operation, security: {results: {}}, definition, ...params};

      operationParams.security.results =
          await this.authorizeRequest(apiContext, req, res, operationParams, authorizers);

      this.logger.info(`Calling operation ${operationId}`);

      // Note: The handler function may modify the "res" object and/or return a response body.
      // If "res.body" is undefined we use the return value as the body.
      const resBody = await operationHandler(req, res, operationParams);
      res.body = res.body ?? resBody;

      // If status code is not specified and a non-ambiguous default status code is available, use it
      res.statusCode = res.statusCode ?? getDefaultStatusCode(operation);

      this.validateResponse(apiContext, res);
    };
  }

  protected validateResponse({api, operation}: OpenAPI.Context, res: Response) {
    const {statusCode, headers, body} = res;
    const errors: ErrorObject[] = [];

    // Note that this call uses a customizeAjv function to configure removeAdditional
    const bodyErrors = api.validateResponse(body, operation).errors;

    if (bodyErrors) {
      errors.push(...bodyErrors);
    }

    const headerErrors = api.validateResponseHeaders(headers, operation, {
      statusCode,
      setMatchType: OpenAPI.SetMatchType.Superset,
    }).errors;

    if (headerErrors) {
      errors.push(...headerErrors);
    }

    this.handleValidationErrors(errors, `Response doesn't match schema`, this.invalidResponseStrategy);

  }

  protected handleValidationErrors(errors: ErrorObject[] | null | undefined, title: string, strategy: FailStrategy) {
    if (errors?.length) {
      this.fail(`${title}: ${formatArray(errors, formatValidationError)}`, strategy);
    }
  }

  private fail(message: string, strategy: FailStrategy) {
    if (strategy === 'throw') {
      throw new Error(message);
    }

    this.logger.warn(message);
  }

  /**
   * Register interceptor function(s) which are executed for every request (similar to Express MW).
   * Note that the interceptors are invoked before the request is validated or routed (mapped to an operation).
   *
   * @param interceptors Interceptor functions
   * @return This instance, for chaining of calls
   */
  intercept(...interceptors: Interceptor<T>[]): this {
    this.interceptors.push(...interceptors);

    return this;
  }

  /**
   * Register an OpenAPI definition and associated operation handlers.
   *
   * @param params Parameters
   * @return This instance, for chaining of calls
   */
  register({definition, operations, authorizers, path}: RegistrationParams<T>): this {
    this.apiPromises.push(this.createApiAsync({
      ...this.apiOptions,
      definition,
      apiRoot: path,
      validate: true
    }, operations, authorizers));

    return this;
  }

  /**
   * Handle the given request by validating and routing it using the registered API definitions.
   * If the request is valid against the definition, the matching operation handler is invoked, and any value
   * returned from it is returned, including thrown errors.
   * If the request is invalid or no operation handler is found, an error is thrown.
   *
   * @param req Request
   * @param res Pending response (filled in by this method)
   * @param params Request params
   * @returns Empty promise if successful; rejected promise the request could not be routed
   *          or if the operation handler threw an error.
   */
  protected async routeAsync(
      req: RawRequest,
      res: Response,
      params: RequestParams<T>,
  ): Promise<void> {
    if (!isRawRequest(req)) {
      throw new Error(`Invalid HTTP request`);
    }
    const apis = await this.getApisAsync();

    if (!apis.length) {
      throw new Error(`No APIs are registered`);
    }

    // Invoke the interceptors
    for (const interceptor of this.interceptors) {
      await interceptor(req, res, params);
    }

    let err: Errors.NotFoundError | undefined;

    // We support multiple API definitions by looping through them as long as Invalid operation is thrown
    for (const api of apis) {
      try {
        this.logger.debug(`Attempting to route ${req.path} to ${api.apiRoot}`);

        return await api.handleRequest(req, {res, params});
      } catch (e) {
        if (e instanceof Errors.NotFoundError) {
          this.logger.debug(`Route ${req.path} not found in ${api.apiRoot}`);
          err = e;
        } else {
          throw e;
        }
      }
    }

    throw err ?? new Error(`No routes registered`);
  }

  /**
   * Handle the given request by routing it and then wrapping the result in a response.
   * If an error was thrown, the error handler function is invoked to convert it to a response.
   *
   * @param req Request
   * @param data Custom data
   * @returns Response
   */
  async handleAsync(req: RawRequest, ...[data]: T[]): Promise<RawResponse> {
    const params: RequestParams<T> = {api: this, data};
    const id = `${req.method?.toUpperCase()} ${req.path}`;
    this.logger.info(`->${id}`);

    const res: Response = {headers: {}};

    try {
      await this.routeAsync(req, res, params);
    } catch (err) {
      this.logger.warn(`Error: ${id}: "${err.name}: ${err.message}"`);

      await this.errorHandlerAsync(req, res, params, err);
    }

    res.statusCode = res.statusCode ?? 500;
    this.logger.info(`<-${id}: ${res.statusCode}`);

    return this.formatResponse(res);
  }
}
