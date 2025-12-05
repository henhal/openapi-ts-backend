const {MODULE_PATH = '@openapi-ts/backend'} = process.env;

export const utils = `
/**
 * Get property K in T if it exists, otherwise D.
 */
export type Property<T, K extends keyof any, D = unknown> =
  K extends keyof T
    ? ([T[K]] extends [never | undefined]
      ? D
      : T[K])
    : D;

/**
 *  Like keyof but values. Get all values of T if it is an object, otherwise D.
 */
export type ValueOf<T, D = never> = T extends Record<string, unknown> ? T[keyof T] : D;

export type EmptyObject = Record<never, never>;

export type StatusCode<Status> =
    Status extends '4XX' ? FourXX :
        Status extends '5XX' ? FiveXX :
            Status extends number ? Status :
                Status extends \`\${infer N extends number}\` ? N :
                    never;

export type FourXX = 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 |
    410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 421 |
    422 | 423 | 424 | 425 | 426 | 428 | 429 | 431 | 451;

export type FiveXX = 500 | 501 | 502 | 503 | 504 | 505 | 506 | 507 | 508 | 510 | 511;
`;

export const requests = `
import {Params, Request} from '@openapi-ts/request-types';
import {operations} from './spec';
import {EmptyObject, Property, ValueOf, StatusCode} from './utils';

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

export type OperationResponse<OpName extends keyof operations> = {
    [Status in keyof operations[OpName]['responses']]:
    operations[OpName]['responses'][Status] extends {
            content: infer Content;
        }
        ? {
            [CT in keyof Content]: {
                statusCode: StatusCode<Status>;
                headers: { 'Content-Type': CT };
                body: Content[CT];
            }
        }[keyof Content]
        : {
            statusCode: StatusCode<Status>;
            headers: EmptyObject;
        };
}[keyof operations[OpName]['responses']]

export type ResponseHeaders<OperationId extends keyof operations> =
    Property<ValueOf<Property<operations[OperationId], 'responses', EmptyObject>>, 'headers'>;

export type OperationRequest<OperationId extends keyof operations> = Request<
    RequestBody<OperationId>,
    Params & RequestPathParams<OperationId>,
    Params & RequestQuery<OperationId>,
    Params & RequestHeaders<OperationId>>;
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