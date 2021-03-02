import * as OpenAPI from 'openapi-backend';

import Ajv from 'ajv';
import {Params, RawParams} from './types';

type ParamSchema = {
  type: 'object';
  required: string[];
  properties: Record<string, any>;
};

export type OneOrMany<T> = T | Array<T>;

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

export function parseParameters(params: Readonly<RawParams>, schema: ParamSchema): Params {
  const result = JSON.parse(JSON.stringify(params));
  const valid = ajv.compile(schema)(result);

  console.log(`Param schema is valid: ${valid}`);
  console.log(result);

  return result;
}

export function mapObject<K extends string, V, W>(obj: Record<K, V>, func: (value: V, key: K, obj: Record<K, V>) => W) {
  return Object.fromEntries(Object.entries<V>(obj).map(([k, v]) => [k, func(v, k as K, obj)]));
}

export function transform<T, U>(value: OneOrMany<T>, func: (value: T) => U): OneOrMany<U> {
  return Array.isArray(value) ? value.map(func) : func(value);
}

export function oneOrMany<T, U>(func: (value: T) => U): (value: OneOrMany<T>) => OneOrMany<U> {
  return value => Array.isArray(value) ? value.map(func) : func(value);
}

export function inRange(min: number, max: number): (value: number) => boolean {
  return value => value >= min && value < max;
}