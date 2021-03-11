import * as OpenAPI from "openapi-backend";

import {OneOrMany} from './utils';
import {OpenApi} from './openapi';
import {OpenAPIV3} from 'openapi-types';

export type ApiContext = OpenAPI.Context;

export type Params<K extends string = string, V = OneOrMany<string | number | boolean | undefined>> = Record<K, V>;

export type StringParams = Params<string, OneOrMany<string>>;

/**
 * @template T Type of value or promised value
 */
export type Awaitable<T> = T | Promise<T>;

/**
 * A typed request
 * @template Body Type of request body
 * @template PathParams Type of request path parameters
 * @template Query Type of request query
 * @template Headers Type of request headers
 *
 * @property method HTTP method
 * @property path Path
 * @property params Path params
 * @property headers Headers
 * @property body Body content parsed from JSON
 * @property query Query string or parsed query object
 *
 */
export interface Request<Body = unknown,
    PathParams extends Params = Params,
    Query extends Params = Params,
    Headers extends Params = Params,
    Cookies extends Params = Params> {
  method: string;
  path: string;
  params: PathParams;
  query: Query;
  headers: Headers;
  cookies: Cookies;
  body: Body;
}

/**
 * Response - this is an output parameter for a handler function to fill in
 * @template Body Type of response body
 * @template Headers Type of response headers
 *
 * @property statusCode HTTP status code
 * @property body Body content which will be sent as JSON
 * @property headers Headers
 */
export interface Response<Body = unknown, Headers extends Params = Params> {
  statusCode?: number;
  headers: Partial<Headers>;
  body?: Body;
}

export type RawRequest = {
  method: string;
  path: string;
  query?: StringParams;
  headers: StringParams;
  body?: unknown;
};

export type RawResponse = {
  statusCode: number;
  headers: StringParams;
  body?: unknown
};

export interface RequestParams<T = unknown> {
  readonly api: OpenApi<T>;
  readonly data: T;
}

/**
 * An error handler invoked when a route handler throws an error or when
 * a request could not be routed at all.
 * This function should modify the response accordingly, by _at least_ setting res.statusCode.
 *
 * @template P      Type of request params
 *
 * @param req       Request
 * @param res       Response
 * @param context   Context
 * @param err       Error thrown by the handler or router
 * @async
 */
export type ErrorHandler<T = unknown> = (
    req: RawRequest,
    res: Response,
    params: RequestParams<T>,
    err: Error,
) => Awaitable<void>

/**
 * An interceptor invoked for every request before routing it. Headers and other parameters are not coerced.
 */
export type Interceptor<T> = (
    req: RawRequest,
    res: Response,
    params: RequestParams<T>
) => Awaitable<void>;

/**
 * The params provided to request handlers
 */
export type OperationParams<T = unknown> = RequestParams<T> & {
  operation: OpenAPIV3.OperationObject;
  definition: OpenAPIV3.Document;
  security: {
    results: Record<string, unknown>;
  };
};

/**
 * A handler implementing a single API operation.
 * The request and response types are coerced to fit the schemas of the matched operation.
 *
 * This function may alter the given response object and/or return a response body.
 * If res.body is not set when this function returns, the return value of the handler will be used as the response body.
 * If res.statusCode is not set when this function returns and a single 2xx status code exists in the response schema,
 * it will be used. Otherwise, not setting any status code will cause a 500 error.
 *
 * @template T          Type of custom data passed in params
 * @template Req        Type of request
 * @template Res        Type of response
 *
 * @param req           Request
 * @param res           Response
 * @param params        Operation params
 * @async
 * @returns Response body or nothing
 */
export type RequestHandler<T,
    Req extends Request = Request,
    Res extends Response = Response> = (
        req: Req,
        res: Res,
        params: OperationParams<T>) => Awaitable<Res['body'] | void>;

/**
 * A security requirement to be fulfilled by an authorizer
 */
export type SecurityRequirement = {
  name: string;
  scheme: OpenAPIV3.SecuritySchemeObject;
  parameters: {
    scopes?: string[];
  };
};
/**
 * A handler implementing a security scheme.
 *
 * Authorizers are registered to handle a given securityScheme as defined in the API definition.
 * The authorizer may throw an error if the request was not properly authenticated or return
 * data related to the authentication so that it can be stored in the context.
 * The value returned from the authorizer will be stored in the API context's security object.
 * Example: If an authorized is registered for the security scheme "ApiKey", the value returned
 * from the authorizer will be stored in context.security['ApiKey'].
 *
 * @template T  Type of data
 * @template R  Type of produced result for this security scheme, e.g. a session, user object or similar
 *
 * @param req       Request
 * @param res       Response
 * @param params    Request params
 * @async
 * @returns Security scheme result
 */
export type Authorizer<T, R = unknown> = (
    req: Request,
    res: Response,
    params: OperationParams<T>,
    requirement: SecurityRequirement
) => Awaitable<R>;

/**
 * @template P Type of params
 *
 * @property definition     Path to an OpenAPI specification file, or an OpenAPI specification object.
 * @property operations     Map of operationId:s in the definition to OperationHandler functions
 * @property [authorizers]  Map of securityScheme names in the definition to Authorizer functions
 * @property [path = '/']   API path prefix for this API
 */
export type RegistrationParams<T> = {
  definition: OpenAPI.Document | string;
  operations: Record<string, RequestHandler<T>>;
  authorizers?: Record<string, Authorizer<T>>;
  path?: string;
};

