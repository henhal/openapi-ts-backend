import * as OpenAPI from "openapi-backend";

import {Request, Response, StringParams} from '@openapi-ts/request-types';
import {OpenApi} from './openapi';
import {Document, Operation} from "openapi-backend";
import {OpenAPIV3, OpenAPIV3_1} from "openapi-types";

export * from '@openapi-ts/request-types';

/**
 * @template T Type of value or promised value
 */
export type Awaitable<T> = T | Promise<T>;

/**
 * A raw request with unparsed string headers and query parameters
 */
export type RawRequest = {
  method: string;
  path: string;
  query?: StringParams;
  headers: StringParams;
  body?: unknown;
};

/**
 * A raw response with string headers
 */
export type RawResponse = {
  statusCode: number;
  headers: StringParams;
  body?: unknown
};

/**
 * Request params passed to every request
 */
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
 * @param params    Params
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
 * An interceptor invoked for every request before routing it. Headers and other parameters are not parsed or coerced.
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
  operation: Operation;
  definition: Document;
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
export type RequestHandler<P = unknown,
    Req extends Request = Request,
    Res extends Response = Response> = (
        req: Req,
        res: Res,
        params: P) => Awaitable<Res['body'] | void>;


type SecuritySchemeObject = OpenAPIV3_1.SecuritySchemeObject | OpenAPIV3.SecuritySchemeObject;
/**
 * A security requirement to be fulfilled by an authorizer
 */
export type SecurityRequirement = {
  name: string;
  scheme: SecuritySchemeObject;
  parameters: {
    scopes?: string[];
  };
};
/**
 * A handler implementing a security scheme.
 *
 * Authorizers are registered to handle a given securityScheme as defined in the API definition.
 * The authorizer must throw an error if the given security scheme was not fulfilled, or return
 * data related to the authentication so that it can be stored in the params.
 * The value returned from the authorizer will be stored in `params.security`.
 * Example: If an authorized is registered for the security scheme "ApiKey", the value returned
 * from the authorizer will be stored in params.security['ApiKey'].
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
  operations: Record<string, RequestHandler<OperationParams<T>>>;
  authorizers?: Record<string, Authorizer<T>>;
  path?: string;
};

