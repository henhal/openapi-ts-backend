import {ErrorObject} from 'ajv';
import * as OpenAPI from 'openapi-backend';

import * as Errors from './errors';
import {
  Authorizer,
  Awaitable,
  ErrorHandler,
  Interceptor,
  OperationHandler,
  Params,
  RawRequest,
  RawResponse,
  RegistrationParams,
  Request,
  RequestParams,
  Response,
  StringParams,
} from './types';
import Operation from "./operation";
import {
  formatArray,
  formatValidationError,
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
  req?: Request; // Assigned lazily
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
  },
  // unauthorizedHandler(apiContext) {
  //   throw new Errors.UnauthorizedError(apiContext);
  // },
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
        apiOptions,
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

    // for (const [scheme, handler] of Object.entries(authorizers)) {
    //   api.registerSecurityHandler(scheme, this.createSecurityHandler(handler, scheme));
    // }

    return api;
  }

  private parseParams(rawParams: StringParams, operation: OpenAPI.Operation, type: ParameterType): Params {
    const {result, errors} = matchSchema<StringParams, Params>(rawParams, getParametersSchema(operation, type));

    this.handleValidationErrors(errors, `Request ${type} params don't match schema`, 'throw');

    return result;
  }

  protected parseRequest(apiContext: OpenAPI.Context): Request {
    const {request: {method, path, params, headers, query, body}, operation} = apiContext;

    return {
      method,
      path,
      params: this.parseParams(params, operation, 'path'),
      headers: this.parseParams(headers, operation, 'header'),
      query: this.parseParams(query, operation, 'query'),
      body
    };
  }

  protected formatResponse(res: Response): RawResponse {
    const {statusCode = 500, headers, body} = res;

    return {
      statusCode,
      headers: mapObject(headers, oneOrMany(String)),
      body,
    };
  }

  private createHandler(
      operationHandler: OperationHandler<T>,
      operationId: string,
      authorizers: Record<string, Authorizer<T>>): OpenApiHandler<T, void> {
    return async (apiContext, data) => {
      // Parse the request the first time
      // TODO currently this handler is not re-used so caching it in data makes no difference really
      data.req = data.req ?? this.parseRequest(apiContext);

      const {api: {definition}, operation} = apiContext;
      const {req, res, params} = data;
      const results: Record<string, any> = {};
      const operationParams = {operation, security: {results}, definition, ...params};

      const errors: Error[] = [];
      let authorized = true;

      // Handle authorization here instead of using security handlers, to enable passing scopes etc
      for (const securityRequirement of operation.security ?? definition.security ?? []) {
        authorized = true;

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
          break;
        }
      }

      if (!authorized) {
        throw new Errors.UnauthorizedError(apiContext.request, errors);
      }

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

  // private createSecurityHandler<R>(
  //     authorizer: Authorizer<T, R>,
  //     name: string,
  // ): OpenApiHandler<T, R> {
  //   return async (apiContext, {res, params}) => {
  //     const {operation, security} = apiContext;
  //
  //     this.logger.info(`Calling authorizer ${name}`);
  //
  //     return authorizer(apiContext.request, res, {operation, security, ...params});
  //   };
  // }

  protected validateResponse({api, operation}: OpenAPI.Context, response: Response) {
    const {statusCode, headers, body} = response;

    // TODO Implement custom validation here instead.
    // Option to control whether fail = throw or warn (default warn) -> failStrategy
    // if statusCode is specified in response schema, validate body and headers, else fail
    // Option to control trimming of body and headers using removeAdditional: 'all' (default 'failing') -> responseTrimming

    this.handleValidationErrors(
        api.validateResponse(body, operation).errors,
        `Response body doesn't match schema`,
        this.invalidResponseStrategy);

    this.handleValidationErrors(
        api.validateResponseHeaders(headers, operation, {
          statusCode,
          setMatchType: OpenAPI.SetMatchType.Superset,
        }).errors,
        `Response headers don't match schema`,
        this.invalidResponseStrategy);
  }

  protected handleValidationErrors(errors: ErrorObject[] | null | undefined, title: string, strategy: FailStrategy) {
    if (errors) {
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
      validate: true,
    }, operations, authorizers));

    return this;
  }

  /**
   * Get the operation with the given ID
   * @param operationId
   * @returns Promised operation object
   */
  async getOperationAsync(operationId: string): Promise<Operation> {
    const apis = await this.getApisAsync();

    for (const api of apis) {
      const operation = api.getOperation(operationId);

      if (operation) {
        return new Operation(api, operation);
      }
    }

    throw new Error(`No registered operation ${operationId}`);
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
