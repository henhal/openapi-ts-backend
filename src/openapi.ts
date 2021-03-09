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
  StringParams,
  RawRequest,
  RawResponse,
  RegistrationParams,
  Request,
  RequestParams,
  Response,
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
  Resolvable,
  resolve,
} from './utils';
import {createLogger, getLogLevels, Logger} from './logger';

type FailStrategy = 'warn' | 'throw';
type ResponseTrimming = 'none' | 'failing' | 'all';

type HandlerData<P extends RequestParams> = {
  req?: Request; // Assigned lazily
  res: Response;
  params: P;
};

// Note: Implementation of OpenAPI.Handler - these arguments match the call to api.handleRequest
type OpenApiHandler<P extends RequestParams, T> = (apiContext: OpenAPI.Context, data: HandlerData<P>) => Awaitable<T>;

export type ApiOptions = Pick<OpenAPI.Options, 'ajvOpts' | 'customizeAjv'>;

const LOG_LEVELS = getLogLevels(process.env.LOG_LEVEL ?? 'info');

const nop = () => {};
const consoleLogger: Logger = createLogger(level => LOG_LEVELS.includes(level) ?
    console[level].bind(null, `${level}:`) :
    nop);
const noLogger: Logger = createLogger(level => nop);

const defaultHandlers: Partial<OpenAPI.Options['handlers']> = Object.freeze({
  validationFail(apiContext) {
    throw new Errors.BadRequestError(apiContext);
  },
  notFound(apiContext) {
    throw new Errors.NotFoundError(apiContext);
  },
  notImplemented(apiContext) {
    throw new Errors.NotImplementedError(apiContext);
  },
  unauthorizedHandler(apiContext) {
    throw new Errors.UnauthorizedError(apiContext);
  },
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

// TODO
class RequestImpl<Body = any,
    PathParams extends Params = Params,
    Query extends Params = Params,
    Headers extends Params = Params> implements Request<Body, PathParams, Query, Headers> {
  readonly method: string;
  readonly path: string;
  readonly params: PathParams;
  readonly query: Query;
  readonly headers: Headers;
  readonly body: Body;
  readonly operation: Operation;
  private readonly apiContext: OpenAPI.Context;

  constructor(req: Request<Body, PathParams, Query, Headers>, op: Operation, apiContext: OpenAPI.Context) {
    this.method = req.method;
    this.path = req.path;
    this.params = req.params;
    this.headers = req.headers;
    this.query = req.query;
    this.body = req.body;
    this.operation = op;
    this.apiContext = apiContext;
  }
}

/**
 * A HTTP API using an OpenAPI definition.
 * This uses the openapi-backend module to parse, route and validate requests created from events.
 *
 * @template Context     Type of context passed to each request
 *
 */
export class OpenApi<S, C> {
  private readonly apiOptions: Partial<OpenAPI.Options>;
  private interceptors: Interceptor<RequestParams<S, C>>[] = [];
  private apiPromises: Promise<OpenAPI.OpenAPIBackend>[] = [];
  private readonly errorHandlerAsync: ErrorHandler<RequestParams<S, C>>;
  private resolvableContext?: Resolvable<Awaitable<C>>;
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
        resolvableContext,
        invalidResponseStrategy = 'warn',
        responseTrimming = 'failing'
      }: {
        apiOptions?: ApiOptions;
        errorHandlerAsync?: ErrorHandler<RequestParams<S, C>>;
        logger?: Logger | null;
        resolvableContext?: Resolvable<Awaitable<C>>;
        invalidResponseStrategy?: FailStrategy;
        responseTrimming?: ResponseTrimming;
      } = {}) {
    this.apiOptions = {
      handlers: {...defaultHandlers}, // must copy
      ...apiOptions,
    };
    this.errorHandlerAsync = errorHandlerAsync;
    this.logger = logger || noLogger;
    this.resolvableContext = resolvableContext;
    this.invalidResponseStrategy = invalidResponseStrategy;
    this.responseTrimming = responseTrimming;
  }

  private async getContextAsync(): Promise<C> {
    const {resolvableContext} = this;

    if (resolvableContext === undefined) {
      return undefined as any;
    }

    return resolve<Awaitable<C>>(resolvableContext);
  }

  private getApisAsync(): Promise<Array<OpenAPI.OpenAPIBackend>> {
    return Promise.all(this.apiPromises);
  }

  private async createApiAsync(apiOptions: OpenAPI.Options,
                               operations: Record<string, OperationHandler<RequestParams<S, C>>>,
                               authorizers: Record<string, Authorizer<RequestParams<S, C>>> = {}) {
    const api = await new OpenAPI.OpenAPIBackend(apiOptions).init();

    for (const [id, handler] of Object.entries(operations)) {
      api.registerHandler(id, this.createHandler(handler, id));
    }

    for (const [scheme, handler] of Object.entries(authorizers)) {
      api.registerSecurityHandler(scheme, this.createSecurityHandler(handler, scheme));
    }

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
      operationHandler: OperationHandler<RequestParams<S, C>>,
      operationId: string,
  ): OpenApiHandler<RequestParams<S, C>, void> {
    return async (apiContext, data) => {
      // Parse the request the first time (TODO currently this handler is not re-used)
      data.req = data.req ?? this.parseRequest(apiContext);

      const {operation} = apiContext;
      const {req , res, params} = data;

      this.logger.info(`Calling operation ${operationId}`);

      // Note: The handler function may modify the "res" object and/or return a response body.
      // If "res.body" is undefined we use the return value as the body.
      const resBody = await operationHandler(req, res, {apiContext, ...params});
      res.body = res.body ?? resBody;

      // If status code is not specified and a non-ambiguous default status code is available, use it
      res.statusCode = res.statusCode ?? getDefaultStatusCode(operation);

      this.validateResponse(apiContext, res);
    };
  }

  private createSecurityHandler<T>(
      authorizer: Authorizer<RequestParams<S, C>, T>,
      name: string,
  ): OpenApiHandler<RequestParams<S, C>, T> {
    return async (apiContext, {res, params}) => {
      this.logger.info(`Calling authorizer ${name}`);

      return authorizer(apiContext.request, res, {apiContext, ...params});
    };
  }

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
  intercept(...interceptors: Interceptor<RequestParams<S, C>>[]): this {
    this.interceptors.push(...interceptors);

    return this;
  }

  /**
   * Register an OpenAPI definition and associated operation handlers.
   *
   * @param params Parameters
   * @return This instance, for chaining of calls
   */
  register({definition, operations, authorizers, path}: RegistrationParams<RequestParams<S, C>>): this {
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
      params: RequestParams<S, C>,
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
   * @param source Request source
   * @returns Response
   */
  async handleAsync(req: RawRequest, source: S): Promise<RawResponse> {
    const context = await this.getContextAsync();
    const params: RequestParams<S, C> = {source, context, api: this};
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