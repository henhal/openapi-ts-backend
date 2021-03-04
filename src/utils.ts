import * as OpenAPI from 'openapi-backend';

import Ajv, {ErrorObject} from 'ajv';
import {Params, RawParams} from './types';

export type OneOrMany<T> = T | Array<T>;

// The "not a function restriction" solves TS2349 and enables using typeof === 'function' to determine if T is callable.
export type Resolvable<T> = T extends Function ? never : T | (() => T);

type ParamSchema = {
  type: 'object';
  required: string[];
  properties: Record<string, any>;
  additionalProperties?: boolean;
};

const ajv = new Ajv({coerceTypes: 'array'});

export function resolve<T>(resolvable: Resolvable<T>): T {
  return typeof resolvable === 'function' ? resolvable() : resolvable;
}

export function formatValidationError(error: ErrorObject): string {
  return `At '${error.dataPath}': ${Object.entries(error.params)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join(', ')}`;
}

export function getParametersSchema(
    {parameters = []}: OpenAPI.Operation,
    type: 'header' | 'query' | 'path'
): ParamSchema {
  const result: ParamSchema = {type: 'object', required: [], properties: {}, additionalProperties: true};

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
  const result: RawParams = JSON.parse(JSON.stringify(params));
  const validate = ajv.compile(schema)

  validate(result);

  if (validate.errors) {
    // TODO would need type of params for a meaningful error.
    console.warn(`Request params don't match schema: ${JSON.stringify(validate.errors.map(formatValidationError))}`);

    // TODO should we throw an error here? It means the parameters won't match the generated types
  }

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