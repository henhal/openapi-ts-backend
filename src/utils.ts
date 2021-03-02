import * as OpenAPI from 'openapi-backend';

import Ajv from 'ajv';
import {Params, RawParams} from './types';

type ParamSchema = {
  type: 'object';
  required: string[];
  properties: Record<string, any>;
};

const ajv = new Ajv({coerceTypes: 'array'});

export function getParametersSchema(
    {parameters = []}: OpenAPI.Operation,
    type: 'header' | 'query' | 'path'
) {
  const result: ParamSchema = {type: 'object', required: [], properties: {}};

  for (const parameter of parameters) {
    if ('in' in parameter && parameter.in === type) {
      const {name, required = false, schema = {}} = parameter;

      result.properties[name] = schema;

      if (required) {
        result.required.push(name);
      }
    }
  }

  return result;
}

export function parseParameters(params: RawParams, schema: ParamSchema): Params {
  const valid = ajv.compile(schema)(params);

  console.log(`Param schema is valid: ${valid}`);
  console.log(params);

  return params;
}
