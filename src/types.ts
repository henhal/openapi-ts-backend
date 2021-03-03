import * as OpenAPI from "openapi-backend";

import {OneOrMany} from './utils';

export type ApiContext = OpenAPI.Context;

export type Params<K extends string = string> = Record<K, OneOrMany<string | number | boolean> | undefined>;
export type RawParams = Record<string, OneOrMany<string>>;

/**
 * Request
 * @template B Type of request body
 * @property method HTTP method
 * @property path Path
 * @property headers Headers
 * @property body Body content parsed from JSON
 * @property query Query string or parsed query object
 *
 */
export type Request<Body = any,
    PathParams extends Params = Params,
    Query extends Params = Params,
    Headers extends Params = Params> = {
  method: string;
  path: string;
  params: PathParams;
  query: Query;
  headers: Headers;
  body: Body;
};

export type RawRequest = {
  method: string;
  path: string;
  headers: RawParams;
  query?: RawParams;
  body?: unknown;
};

export type RawResponse = {
  statusCode: number;
  headers: RawParams;
  body?: unknown
};

export type PendingRawResponse = {
  statusCode?: number;
  headers: RawParams;
  body?: unknown
};

/**
 * Response - this is an output parameter for a handler function to fill in
 * @template B Type of response body
 * @property statusCode HTTP status code
 * @property body Body content which will be sent as JSON
 * @property headers Headers
 */
export type Response<Body = any, Headers extends Params = Params> = {
  statusCode?: number;
  headers: Partial<Headers>;
  body?: Body;
};

/**
 * @template T Type of value or promised value
 */
export type Awaitable<T> = T | Promise<T>;

type NotFunction<T> = T extends Function ? never : T;

export type Resolvable<T> = (NotFunction<T> | (() => T));

export interface RequestParams<S = unknown, C = unknown> {
  source: S;
  context: C;
}

/**
 * An error handler invoked when a route handler throws an error or when
 * a request could not be routed at all.
 * This function should modify the response accordingly, by _at least_ setting res.statusCode.
 *
 * @template C      Type of context
 * @param req       Request
 * @param res       Response
 * @param context   Context
 * @param err       Error thrown by the handler or router
 * @async
 */
export type ErrorHandler<P extends RequestParams = RequestParams> = (
    req: RawRequest,
    res: PendingRawResponse,
    params: P,
    err: Error,
) => Awaitable<void>

export type Handler<P extends RequestParams, T> = (
    req: RawRequest,
    res: PendingRawResponse,
    params: P
) => Awaitable<T>;

/**
 * An interceptor invoked for every request before routing it.
 */
export type Interceptor<P extends RequestParams> = Handler<P, void>;

/**
 * The context always present in all routed requests
 */
export interface OperationParams {
  apiContext: ApiContext;
}

/**
 * A handler implementing a single API operation
 * This function may alter the given response object and/or return a response body.
 * If res.body is not set when this function returns, the return value of the handler will be used as the response body.
 * If res.statusCode is not set when this function returns, 200 will be used.
 *
 * @template P          Type of context
 * @template ReqBody    Type of request body
 * @template ResBody    Type of response body
 * @param req           Request
 * @param res           Response
 * @param context       Context
 * @async
 * @returns Response body or nothing
 */
export type OperationHandler<P extends RequestParams,
    Req extends Request = Request,
    Res extends Response = Response> = (
        req: Req,
        res: Res,
        params: P & OperationParams) => Awaitable<Res['body'] | void>;

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
 * @template C  Type of context
 * @template T  Type of produced security scheme data
 * @param req       Request
 * @param res       Response
 * @param context   Context
 * @async
 * @returns Security scheme data
 */
export type Authorizer<P extends RequestParams, T = unknown> = Handler<P & OperationParams, T>;

/**
 * @template C Type of context
 * @property definition     Path to an OpenAPI specification file, or an OpenAPI specification object.
 * @property operations     Map of operationId:s in the definition to OperationHandler functions
 * @property [authorizers]  Map of securityScheme names in the definition to Authorizer functions
 * @property [path = '/']   API path prefix for this API
 */
export type RegistrationParams<P extends RequestParams> = {
  definition: OpenAPI.Document | string;
  operations: Record<string, OperationHandler<P>>;
  authorizers?: Record<string, Authorizer<P, any>>;
  path?: string;
};

