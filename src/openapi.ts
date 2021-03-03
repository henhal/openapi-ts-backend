import {ErrorObject} from 'ajv';
import * as OpenAPI from 'openapi-backend';

import * as Errors from './errors';
import {
  Authorizer,
  Awaitable,
  ErrorHandler,
  Interceptor,
  OperationHandler,
  PendingRawResponse,
  RawRequest,
  RawResponse,
  RegistrationParams,
  Request,
  Response,
} from './types';
import Operation from "./operation";
import {formatValidationError, getParametersSchema, inRange, mapObject, oneOrMany, parseParameters} from './utils';
import {createLogger, Logger} from './logger';

const defaultHandlers: Partial<OpenAPI.Options['handlers']> = Object.freeze({
  validationFail(apiContext) {
    throw new Errors.ValidationFailError(apiContext);
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

function toRequest(req: OpenAPI.ParsedRequest, operation: OpenAPI.Operation): Request {
  // Headers, path params and query params are coerced to their schema types
  return {
    method: req.method,
    path: req.path,
    params: parseParameters(req.params, getParametersSchema(operation, 'path')),
    headers: parseParameters(req.headers, getParametersSchema(operation, 'header')),
    query: parseParameters(req.query, getParametersSchema(operation, 'query')),
    body: req.body,
  };
}

function fromResponse(res: Response, {responses = {}}: OpenAPI.Operation): RawResponse {
  let {statusCode, headers, body} = res;

  if (statusCode === undefined) {
    // If statusCode is not set and there is exactly one successful response, we use it automatically.
    const codes = Object.keys(responses || {}).map(Number).filter(inRange(200, 400));

    if (codes.length !== 1) {
      // No statusCode given and it's impossible to determine a default one from the response schemas
      throw new Error(`Ambiguous implicit response status code`);
    }
    statusCode = codes[0];
  }

  return {
    statusCode,
    headers: mapObject(headers, oneOrMany(String)),
    body,
  };
}

// Note: Implementation of OpenAPI.Handler - these arguments match the call to api.handleRequest
type OpenApiHandler<P, T> = (apiContext: OpenAPI.Context, response: PendingRawResponse, params: P) => Awaitable<T>;

export type ApiOptions = Pick<OpenAPI.Options, 'ajvOpts' | 'customizeAjv'>;

const consoleLogger: Logger = createLogger(level => console[level].bind(null, `${level}:`));
const noLogger: Logger = createLogger(level => () => {});

/**
 * A HTTP API using an OpenAPI definition.
 * This uses the openapi-backend module to parse, route and validate requests created from events.
 *
 * @template RP     Type of params passed to each request
 *
 */
export class OpenApi<RP extends object> {
  private readonly apiOptions: Partial<OpenAPI.Options>;
  private interceptors: Interceptor<RP>[] = [];
  private apiPromises: Promise<OpenAPI.OpenAPIBackend>[] = [];
  private readonly errorHandlerAsync: ErrorHandler<RP>;
  private readonly logger: Logger;

  /**
   * Constructor
   * @param params Parameters
   * @param [params.apiOptions] Options passed to the OpenAPIBackend instance.
   * @param [params.errorHandlerAsync] A function creating a response from an error thrown by the API.
   */
  constructor({apiOptions, errorHandlerAsync = Errors.defaultErrorHandler, logger = consoleLogger}: {
    apiOptions?: ApiOptions;
    errorHandlerAsync?: ErrorHandler<RP>;
    logger?: Logger | null;
  } = {}) {
    this.apiOptions = {
      handlers: {...defaultHandlers}, // must copy
      ...apiOptions,
    };
    this.errorHandlerAsync = errorHandlerAsync;
    this.logger = logger || noLogger;
  }

  private getApisAsync(): Promise<Array<OpenAPI.OpenAPIBackend>> {
    return Promise.all(this.apiPromises);
  }

  private async createApiAsync<P extends RP>(apiOptions: OpenAPI.Options,
                                             operations: Record<string, OperationHandler<P, any, any>>,
                                             authorizers: Record<string, Authorizer<P, any>> = {}) {
    const api = await new OpenAPI.OpenAPIBackend(apiOptions).init();

    for (const [id, handler] of Object.entries(operations)) {
      api.registerHandler(id, this.createHandler(handler, id));
    }

    for (const [scheme, handler] of Object.entries(authorizers)) {
      api.registerSecurityHandler(scheme, this.createSecurityHandler(handler, scheme));
    }

    return api;
  }

  private createHandler<P extends RP>(
      operationHandler: OperationHandler<P>,
      operationId: string,
  ): OpenApiHandler<P, void> {
    return async (apiContext, response, params) => {
      const {operation, request} = apiContext;
      this.logger.info(`Calling operation ${operationId}`);

      const req = toRequest(request, operation);

      // TODO Should response be copied before re-typed and passed to the operation?
      //  Currently we broaden the type, pass it to the operation handler, then convert all params to strings and copy
      //  back to the same object.
      const res: Response = response;

      // Note: The handler function may modify the "res" object and/or return a response body.
      // If "res.body" is undefined we use the return value as the body.
      const result = await operationHandler(req, res, {apiContext, ...params});
      res.body = res.body ?? result;
      Object.assign(response, fromResponse(res, operation));

      this.validateResponse(response, operation, apiContext);
    }
  }

  private createSecurityHandler<P extends RP, T>(
      authorizer: Authorizer<P, T>,
      name: string
  ): OpenApiHandler<P, T> {
    return async (apiContext, response: PendingRawResponse, params: P) => {
      this.logger.info(`Calling authorizer ${name}`);

      return authorizer(apiContext.request, response, {apiContext, ...params});
    };
  }

  protected validateResponse(response: Response, operation: OpenAPI.Operation, {api}: OpenAPI.Context) {
    const {statusCode, headers, body} = response;

    this.handleValidationErrors(api.validateResponse(body, operation).errors, `Response body doesn't match schema`);

    this.handleValidationErrors(api.validateResponseHeaders(headers, operation, {
      statusCode,
      setMatchType: OpenAPI.SetMatchType.Superset,
    }).errors, `Response headers don't match schema`);
  }

  protected handleValidationErrors(errors: ErrorObject[] | null | undefined, message: string) {
    if (errors) {
      // TODO constructor option invalidResponseAction: 'warn' | 'fail'
      this.logger.warn(`${message}: ${JSON.stringify(errors.map(formatValidationError))}`);
    }
  }

  /**
   * Register interceptor function(s) which are executed for every request (similar to Express MW).
   * Note that the interceptors are invoked before the request is validated or routed (mapped to an operation).
   *
   * @param interceptors Interceptor functions
   * @return This instance, for chaining of calls
   */
  intercept<P extends RP>(...interceptors: Interceptor<P>[]): this {
    this.interceptors.push(...interceptors as Interceptor<RP>[]);

    return this;
  }

  /**
   * Register an OpenAPI definition and associated operation handlers.
   *
   * @param params Parameters
   * @return This instance, for chaining of calls
   */
  register<P extends RP>({definition, operations, authorizers, path}: RegistrationParams<P>): this {
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
   * @param res Response
   * @param params Request params
   * @returns The value from the invoked operation handler including any rejected promises; or a rejected promise
   * if the request could not be routed.
   */
  protected async routeAsync(
      req: RawRequest,
      res: PendingRawResponse,
      params: RP,
  ): Promise<void> {
    const apis = await this.getApisAsync();

    if (!apis.length) {
      throw new Error(`No APIs are registered`);
    }

    for (const interceptor of this.interceptors) {
      await interceptor(req, res, params);
    }

    let err: Errors.NotFoundError | undefined;

    // We support multiple API definitions by looping through them as long as Invalid operation is thrown
    for (const api of apis) {
      try {
        this.logger.debug(`Attempting to route ${req.path} to ${api.apiRoot}`);

        this.logger.info(`Calling api.handleRequest with ${JSON.stringify(res)}`);
        return await api.handleRequest(req, res, params);
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
   * @param params Request params
   * @returns Response
   */
  async handleAsync(req: RawRequest, params: RP): Promise<RawResponse> {
    const id = `${req.method.toUpperCase()} ${req.path}`;
    this.logger.info(`->${id}`);

    const res: PendingRawResponse = {headers: {}};

    try {
      await this.routeAsync(req, res, params);
    } catch (err) {
      this.logger.warn(`Error: ${req.path}: "${err.name}: ${err.message}"`);

      await this.errorHandlerAsync(req, res, params, err);
      res.statusCode = res.statusCode ?? 500;
    }

    this.logger.info(`<-${id}: ${res.statusCode}`);

    return res as RawResponse;
  }
}
