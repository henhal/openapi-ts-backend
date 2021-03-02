#!/usr/bin/env node
import * as yaml from 'js-yaml';
import generateOpenApiTypes from 'openapi-typescript';
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'fs';
import path from 'path';

import {getApiOperationIds} from './parser';
import * as templates from './templates';

const YAML_EXTENSION = /\.ya?ml$/;

const [inputFile, outputDir] = process.argv.slice(2);

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

if (!inputFile || !outputDir) {
  console.error(`Usage: typegen <path to OpenAPI document> <output directory>`);
  process.exit(1);
}

if (!existsSync(outputDir)) {
  mkdirSync(outputDir);
}

createSpecTypes(inputFile, outputDir).then(specTypesPath => {
  const operationIds = getApiOperationIds(specTypesPath);

  write(outputDir, `helpers.ts`, templates.helpers);
  write(outputDir, `operations.ts`, templates.operations);
  write(outputDir, `index.ts`, templates.index.replace('$OPERATIONS',
      operationIds.map(id => `  ${id}: Operation<P, '${id}'>;`).join('\n')));

  console.log(`Types written to ${outputDir}`);
});
