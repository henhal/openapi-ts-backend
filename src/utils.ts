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

export function formatArray<T>(items: T[], formatter: (item: T) => string, prefix = `\n  * `): string {
  return items.map(item => `${prefix}${formatter(item)}`).join('');
}

export type ParameterType = 'header' | 'query' | 'path';

export function getParametersSchema(
    {parameters = []}: OpenAPI.Operation,
    type: ParameterType
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

export function matchSchema<T, U>(source: Readonly<T>, schema: ParamSchema): {result: U, errors?: ErrorObject[]} {
  // Ajv mutates the passed object so we pass a copy
  const result = JSON.parse(JSON.stringify(source));
  const validate = ajv.compile(schema);

  validate(result);

  return {result, errors: validate.errors ?? undefined};
}

/**
 * Map the values of an object
 * @param obj Source object
 * @param func Transform function
 */
export function mapObject<K extends string, V, W>(obj: Record<K, V>, func: (value: V, key: K, obj: Record<K, V>) => W) {
  return Object.fromEntries(Object.entries<V>(obj).map(([k, v]) => [k, func(v, k as K, obj)]));
}

export function transform<T, U>(value: OneOrMany<T>, func: (value: T) => U): OneOrMany<U> {
  return Array.isArray(value) ? value.map(func) : func(value);
}

/**
 * Apply a transformation to a single value or an array of values
 * @param func Transform function
 * @returns Single transformed value or array of transformed values
 */
export function oneOrMany<T, U>(func: (value: T) => U): (value: OneOrMany<T>) => OneOrMany<U> {
  return value => Array.isArray(value) ? value.map(func) : func(value);
}

/**
 * Return a number range validator function
 * @param min Min value (inclusive)
 * @param max Max value (exclusive)
 */
export function inRange(min: number, max: number): (value: number) => boolean {
  return value => value >= min && value < max;
}