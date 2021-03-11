const {MODULE_PATH = 'openapi-ts-backend'} = process.env;

export const utils = `
/**
 * Get T[K] if K is a key in T, otherwise D
 */
export type IndexBy<T, K extends keyof any, D = unknown> = (K extends keyof T ? T[K] : D);

/**
 *  Get all values of T if it is an object, otherwise D
 */
export type ValueOf<T, D = never> = T extends Record<string, unknown> ? T[keyof T] : D;
`;

export const requests = `
import {operations} from './spec';
import {IndexBy, ValueOf} from './utils';

export type RequestBody<OperationId extends keyof operations> =
    operations[OperationId] extends {requestBody: Record<string, any>} ?
      ValueOf<operations[OperationId]['requestBody']['content'], void> :
      void;

export type RequestPathParams<OperationId extends keyof operations> =
    IndexBy<operations[OperationId]['parameters'], 'path', {}>;

export type RequestQuery<OperationId extends keyof operations> =
    IndexBy<operations[OperationId]['parameters'], 'query', {}>;

export type RequestHeaders<OperationId extends keyof operations> =
    IndexBy<operations[OperationId]['parameters'], 'header', {}>;

export type ResponseBody<OperationId extends keyof operations> =
    ValueOf<IndexBy<ValueOf<operations[OperationId]['responses']>, 'content'>, void>;

export type ResponseHeaders<OperationId extends keyof operations> =
    IndexBy<ValueOf<operations[OperationId]['responses']>, 'headers'>;
`;

export const index = `
import {components, operations} from './spec';
import {IndexBy} from './utils';

export type Schemas = IndexBy<components, 'schemas', Record<string, never>>;
export type Responses = IndexBy<components, 'responses', Record<string, never>>;
export type Operations = operations;

export * from './requests';
export * from './operations';
`;

export const operations = `
import {RequestHandler, Params, Request, Response} from '${MODULE_PATH}';
import {operations} from './spec';
import {RequestBody, RequestHeaders, RequestPathParams, RequestQuery, ResponseBody, ResponseHeaders} from './requests';

export type OperationRequest<OperationId extends keyof operations> = Request<
    RequestBody<OperationId>,
    Params & RequestPathParams<OperationId>,
    Params & RequestQuery<OperationId>,
    Params & RequestHeaders<OperationId>>;

export type OperationResponse<OperationId extends keyof operations> = Response<
    ResponseBody<OperationId>,
    Params & ResponseHeaders<OperationId>>;

export type OperationHandler<T, OperationId extends keyof operations> = RequestHandler<T,
    OperationRequest<OperationId>,
    OperationResponse<OperationId>>;
    
export interface OperationHandlers<T>
    extends Record<string, RequestHandler<T, Request<any, any, any, any>, Response<any, any>>> {
$OPERATIONS
}   
`;
