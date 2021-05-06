const {MODULE_PATH = 'openapi-ts-backend'} = process.env;

export const utils = `
/**
 * Get property K in T if it exists, otherwise D.
 */
export type Property<T, K extends keyof any, D = unknown> = (K extends keyof T ? T[K] : D);

/**
 *  Like keyof but values. Get all values of T if it is an object, otherwise D.
 */
export type ValueOf<T, D = never> = T extends Record<string, unknown> ? T[keyof T] : D;

export type EmptyObject = Record<never, never>;
`;

export const requests = `
import {Params, Request, Response} from '@openapi-ts/request-types';
import {operations} from './spec';
import {EmptyObject, Property, ValueOf} from './utils';

export type RequestBody<OperationId extends keyof operations> =
    operations[OperationId] extends {requestBody: Record<string, any>} ?
      ValueOf<operations[OperationId]['requestBody']['content'], void> :
      void;

export type RequestPathParams<OperationId extends keyof operations> =
    Property<Property<operations[OperationId], 'parameters', EmptyObject>, 'path', EmptyObject>;

export type RequestQuery<OperationId extends keyof operations> =
    Property<Property<operations[OperationId], 'parameters', EmptyObject>, 'query', EmptyObject>;

export type RequestHeaders<OperationId extends keyof operations> =
    Property<Property<operations[OperationId], 'parameters', EmptyObject>, 'header', EmptyObject>;

export type ResponseBody<OperationId extends keyof operations> =
    ValueOf<Property<ValueOf<Property<operations[OperationId], 'responses', EmptyObject>>, 'content'>, void>;

export type ResponseHeaders<OperationId extends keyof operations> =
    Property<ValueOf<Property<operations[OperationId], 'responses', EmptyObject>>, 'headers'>;

export type OperationRequest<OperationId extends keyof operations> = Request<
    RequestBody<OperationId>,
    Params & RequestPathParams<OperationId>,
    Params & RequestQuery<OperationId>,
    Params & RequestHeaders<OperationId>>;

export type OperationResponse<OperationId extends keyof operations> = Response<
    ResponseBody<OperationId>,
    Params & ResponseHeaders<OperationId>>;
`;

export const handlers = `
import {Request, Response} from '@openapi-ts/request-types';
import {OperationParams, RequestHandler} from '${MODULE_PATH}';
import {operations} from './spec';
import {OperationRequest, OperationResponse} from './requests';

export type OperationHandler<T, OperationId extends keyof operations> = RequestHandler<OperationParams<T>,
    OperationRequest<OperationId>,
    OperationResponse<OperationId>>;
    
export interface OperationHandlers<T>
    extends Record<string, RequestHandler<OperationParams<T>, Request<any, any, any, any>, Response<any, any>>> {
$OPERATIONS
}   
`;

export const index = `
import {components, operations} from './spec';
import {EmptyObject, Property} from './utils';

export type Schemas = Property<components, 'schemas', EmptyObject>;
export type Responses = Property<components, 'responses', EmptyObject>;
export type Operations = operations;

`;