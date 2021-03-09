import * as OpenAPI from "openapi-backend";

import {OneOrMany} from './utils';
import {OpenApi} from './openapi';

export type ApiContext = OpenAPI.Context;

export type Params<K extends string = string, V = OneOrMany<string | number | boolean | undefined>> = Record<K, V>;
export type StringParams = Params<string, OneOrMany<string>>;

/**
 * Request
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
    Headers extends Params = Params> {
  method: string;
  path: string;
  params: PathParams;
  query: Query;
  headers: Headers;
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

// TODO Response class with methods?
// res.complete(201, {body, headers: {'x-foo': 42}})

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

/**
 * @template T Type of value or promised value
 */
export type Awaitable<T> = T | Promise<T>;

export interface RequestParams<Source = unknown, Context = unknown> {
  source: Source;
  context: Context;
  api: OpenApi<Source, Context>;
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
export type ErrorHandler<P extends RequestParams = RequestParams> = (
    req: RawRequest,
    res: Response,
    params: P,
    err: Error,
) => Awaitable<void>

type Handler<P extends RequestParams, T> = (
    req: RawRequest,
    res: Response,
    params: P
) => Awaitable<T>;

/**
 * An interceptor invoked for every request before routing it.
 */
export type Interceptor<P extends RequestParams> = Handler<P, void>;

/**
 * The context always present in all routed requests
 */
export type OperationParams<P extends RequestParams> = P & {
  apiContext: ApiContext;
};

/**
 * A handler implementing a single API operation
 * This function may alter the given response object and/or return a response body.
 * If res.body is not set when this function returns, the return value of the handler will be used as the response body.
 * If res.statusCode is not set when this function returns and a single 2xx status code exists in the response schema,
 * it will be used. Otherwise, not setting any status code will cause a 500 error.
 *
 * @template P          Type of context
 * @template Req        Type of request
 * @template Res        Type of response
 *
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
        params: OperationParams<P>) => Awaitable<Res['body'] | void>;

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
 * @template P  Type of params
 * @template R  Type of produced result for this security scheme, e.g. a session, user object or similar
 *
 * @param req       Request
 * @param res       Response
 * @param params    Request params
 * @async
 * @returns Security scheme result
 */
export type Authorizer<P extends RequestParams, R = unknown> = Handler<OperationParams<P>, R>;

/**
 * @template P Type of params
 *
 * @property definition     Path to an OpenAPI specification file, or an OpenAPI specification object.
 * @property operations     Map of operationId:s in the definition to OperationHandler functions
 * @property [authorizers]  Map of securityScheme names in the definition to Authorizer functions
 * @property [path = '/']   API path prefix for this API
 */
export type RegistrationParams<P extends RequestParams> = {
  definition: OpenAPI.Document | string;
  operations: Record<string, OperationHandler<P>>;
  authorizers?: Record<string, Authorizer<P>>;
  path?: string;
};

