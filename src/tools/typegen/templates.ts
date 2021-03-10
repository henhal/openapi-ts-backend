export const helpers = `
import {operations} from './spec';

type IndexBy<T, K extends keyof any, D = unknown> = (K extends keyof T ? T[K] : D);

type ValueOf<T, D = never> = T extends {} ? T[keyof T] : D;

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
import {OperationHandler, Request, Response} from 'openapi-ts-backend';
import {Operation} from './operations';
import {components} from './spec';

export interface Operations<T>
    extends Record<string, OperationHandler<T, Request<any, any, any, any>, Response<any, any>>> {
  $OPERATIONS
}

export type Schemas = components['schemas'];
`;

export const operations = `
import {OperationHandler, Params, Request, Response} from 'openapi-ts-backend';
import {operations} from './spec';
import {RequestBody, RequestHeaders, RequestPathParams, RequestQuery, ResponseBody, ResponseHeaders} from './helpers';

export type OperationRequest
<OperationId extends keyof operations> =
    Request<
        RequestBody<OperationId>,
        Params & RequestPathParams<OperationId>,
        Params & RequestQuery<OperationId>,
        Params & RequestHeaders<OperationId>>;

export type OperationResponse<OperationId extends keyof operations> =
    Response<
        ResponseBody<OperationId>,
        Params & ResponseHeaders<OperationId>>;

export type Operation<T, OperationId extends keyof operations> =
    OperationHandler<T,
        OperationRequest<OperationId>,
        OperationResponse<OperationId>>;
`;
