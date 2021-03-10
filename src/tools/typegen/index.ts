import * as yaml from 'js-yaml';
import generateOpenApiTypes from 'openapi-typescript';
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'fs';
import path from 'path';

import {getApiOperationIds} from './parser';
import * as templates from './templates';

const YAML_EXTENSION = /\.ya?ml$/;

function write(dirName: string, fileName: string, data: string) {
  const outputPath = path.resolve(dirName, fileName);

  writeFileSync(outputPath, data);

  return outputPath;
}

async function createSpecTypes(specPath: string, outputDir: string) {
  const raw = readFileSync(specPath).toString();
  const schema = (YAML_EXTENSION.test(specPath)) ? yaml.load(raw) : JSON.parse(raw);

  const ts = generateOpenApiTypes(schema);

  return write(outputDir, 'spec.ts', ts);
}

export default async function main(program: string, command: string, [inputFile, outputDir]: string[]): Promise<void> {
  if (!inputFile || !outputDir) {
    throw new Error(`Usage: ${program} ${command} <path to OpenAPI document> <output directory>`);
  }

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir);
  }

  const specTypesPath = await createSpecTypes(inputFile, outputDir);
  const operationIds = getApiOperationIds(specTypesPath);

  write(outputDir, `helpers.ts`, templates.helpers);
  write(outputDir, `operations.ts`, templates.operations);
  write(outputDir, `index.ts`, templates.index.replace('$OPERATIONS',
      operationIds.map(id => `  ${id}: Operation<T, '${id}'>;`).join('\n')));

  console.log(`Types written to ${outputDir}`);
}
