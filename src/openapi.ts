import * as OpenAPI from 'openapi-backend';

import * as Errors from './errors';
import {
  Authorizer,
  ErrorHandler,
  Interceptor,
  OperationHandler, Params, PendingRawResponse, RawParams, RawRequest, RawResponse,
  RegistrationParams,
  Request,
  Response,
} from './types';
import Operation from "./operation";

const defaultHandlers: Partial<OpenAPI.Options['handlers']> = Object.freeze({
  validationFail(context) {
    throw new Errors.ValidationFailError(context);
  },
  notFound(context) {
    throw new Errors.NotFoundError(context);
  },
  notImplemented(context) {
    throw new Errors.NotImplementedError(context);
  },
  unauthorizedHandler(context) {
    throw new Errors.UnauthorizedError(context);
  },
});

function parseValue(v: string, type: string) {
  switch (type) {
    case 'string':
      return String(v);
    case 'number':
      return Number(v);
    case 'integer':
      return parseInt(v);
    case 'boolean':
      return Boolean(v);
    default:
      return v;
  }
}

type Schema = {
  type: string,
  items?: {
    type: string;
  }
};

type SchemaResolver = (name: string) => Schema | undefined;

function getParameterSchemaResolver(
    {parameters}: OpenAPI.Operation,
    specTarget: string
): SchemaResolver {
  return (name: string) => {
    if (parameters) {
      for (const parameter of parameters) {
        if ('in' in parameter && parameter.in === specTarget && parameter.name === name &&
            parameter.schema && 'type' in parameter.schema ) {
          return parameter.schema as Schema;
        }
      }
    }
  };
}

function getResponseHeaderSchemaResolver({responses}: OpenAPI.Operation, statusCode: number): SchemaResolver {
  return (name: string) => {
    if (responses && statusCode in responses) {
      const response = responses[statusCode];

      if ('headers' in response && response.headers && name in response.headers) {
        const header = response.headers[name];

        if ('schema' in header && header.schema) {
          return header.schema as Schema;
        }
      }
    }
  };
}

function transform<T, U>(x: T | Array<T>, func: (x: T) => U): U | Array<U> {
  return Array.isArray(x) ? x.map(func) : func(x);
}

import Ajv from 'ajv';
// TODO use new Ajv({coerceTypes}), build a full schema of all headers/query/path params and run ajv on it?

function foo({parameters}: OpenAPI.Operation, specTarget: string) {
  if (parameters) {
    //return parameters.filter(p => 'in' in p && p.in === specTarget && 'schema' in p).map(p => p.schema);
    return {
      type: 'object',
      properties: Object.fromEntries((parameters as any[]).filter(p => p.in === specTarget && p.schema).map(p => [p.name, p.schema]))
    };
  }
}

function parseParameters(params: RawParams, schemaResolver: SchemaResolver): Params {
  return Object.fromEntries(Object.entries(params).map(([k, v]) => {
    const schema = schemaResolver(k);

    if (schema) {
      const type = schema.items?.type || schema.type;

      console.debug(`Parsing header ${k} as type ${type}`);
      return [k, transform(v, s => parseValue(s, type))];
    }

    return [k, v];
  }))
}

function createOpenApiHandler<P>(
    operationHandler: OperationHandler<P, Request, Response>,
    name: string
): OpenAPI.Handler {
  // Note: These arguments match the call to api.handleRequest
  return async (apiContext, response: PendingRawResponse, params: P) => {
    const {operation, request} = apiContext;
    console.debug(`Calling ${name}`)
    console.debug(`Operation:\n${JSON.stringify(operation, null, 2)}`);
    console.debug(`Request:\n${JSON.stringify(apiContext.request, null, 2)}`);
    console.debug(`PendingRawResponse:\n${JSON.stringify(response, null, 2)}`);

    // TODO convert apiContext.request to Request, including numerical headers etc
    //const apiRequest = apiContext.request;
    // const {method, path, params, headers, query, body} = apiContext.request;
    // const req: Request = {method, path, params, headers, query, body};
    //const req: Request = {...request, body: request.body};
    // const headers = parseParameters(request.headers, operation.parameters, 'header');
    // const pathParams = parseParameters(request.params, operation.parameters, 'path');
    const req: Request = {
      method: request.method,
      path: request.path,
      params: parseParameters(request.params, getParameterSchemaResolver(operation, 'path')),
      headers: parseParameters(request.headers, getParameterSchemaResolver(operation, 'header')),
      query: parseParameters(request.query, getParameterSchemaResolver(operation, 'query')),
      body: request.body
    };
    const res: Response = response;

    console.log(`Before operation req:\n${JSON.stringify(request, null, 2)}`);

    console.log(`Passing req:\n${JSON.stringify(req, null, 2)}\n\nres:\n${JSON.stringify(res, null, 2)}`);

    const result = operationHandler(req, res, {apiContext, ...params});
    console.log(`After operation res:\n${JSON.stringify(res, null, 2)}`);
    for (const [k, v] of Object.entries(res.headers)) {
      res.headers[k] = transform(v, s => String(s));
    }

    console.log(`After converting res:\n${JSON.stringify(res, null, 2)}`);
    // TODO should we validate the response? statusCode, headers, body?
    return result;
  }
}

async function initApiAsync<P>(apiOptions: OpenAPI.Options,
                               operations: Record<string, OperationHandler<P, any, any>>,
                               authorizers: Record<string, Authorizer<P, any>> = {}) {
  const api = await new OpenAPI.OpenAPIBackend(apiOptions).init();

  for (const [id, handler] of Object.entries(operations)) {
    api.registerHandler(id, createOpenApiHandler(handler, `operation ${id}`));
  }

  for (const [name, handler] of Object.entries(authorizers)) {
    // TODO should authorizers get converted headers etc?
    api.registerSecurityHandler(name, createOpenApiHandler(handler as OperationHandler<any, any, any>, `authorizer ${name}`));
  }

  return api;
}

export type ApiOptions = Pick<OpenAPI.Options, 'ajvOpts' | 'customizeAjv'>;

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

  /**
   * Constructor
   * @param params Parameters
   * @param [params.apiOptions] Options passed to the OpenAPIBackend instance.
   * @param [params.errorHandlerAsync] A function creating a response from an error thrown by the API.
   */
  constructor({apiOptions, errorHandlerAsync = Errors.defaultErrorHandler}: {
    apiOptions?: ApiOptions;
    errorHandlerAsync?: ErrorHandler<RP>;
  } = {}) {
    this.apiOptions = {
      handlers: {...defaultHandlers}, // must copy
      ...apiOptions,
    };
    this.errorHandlerAsync = errorHandlerAsync;
  }

  private getApisAsync(): Promise<Array<OpenAPI.OpenAPIBackend>> {
    return Promise.all(this.apiPromises);
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
    this.apiPromises.push(initApiAsync({
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
  ): Promise<Response['body'] | void> {
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
        console.debug(`Attempting to route ${req.path} to ${api.apiRoot}`);

        console.log(`Calling api.handleRequest with ${JSON.stringify(res)}`);
        return await api.handleRequest(req, res, params);
      } catch (e) {
        if (e instanceof Errors.NotFoundError) {
          console.debug(`Route ${req.path} not found in ${api.apiRoot}`);
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
    console.info(`->${id}`);

    const res: PendingRawResponse = {headers: {}};

    try {
      // Note: The handler function may modify the "res" object.
      // If "res.body" is undefined we use the return value as the body.
      // TODO these conversions should be handled inside the OperationHandler wrapper, so that an operation
      //  specific default value can be added instead of hard-coding 200.
      const result = await this.routeAsync(req, res, params);
      res.statusCode = res.statusCode ?? 200;
      res.body = res.body ?? result as Response['body'];
    } catch (err) {
      console.warn(`Error: ${req.path}: "${err.name}: ${err.message}"`);

      await this.errorHandlerAsync(req, res, params, err);
      res.statusCode = res.statusCode ?? 500;
    }

    console.info(`<-${id}: ${res.statusCode}`);

    return res as RawResponse;
  }
}

// function toStringParams(params: Params): Record<string, string | string[]> {
//   return Object.fromEntries(
//       Object.entries(params)
//           .filter(([k, v]) => v !== undefined)
//           .map(([k, v]) => [k, Array.isArray(v) ? v.map(x => x.toString()) : v!.toString()]));
// }