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

export default async function main(program: string, command: string, args: string[]): Promise<void> {
  const excludeHandlers = args.includes('--exclude-handlers');
  const [inputFile, outputDir] = args.slice(-2);

  if (!inputFile || !outputDir) {
    throw new Error(`Usage: ${program} ${command} <path to OpenAPI document> <output directory>`);
  }

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir);
  }

  const specTypesPath = await createSpecTypes(inputFile, outputDir);
  const operationIds = getApiOperationIds(specTypesPath);
  const modules = ['requests'];

  if (!excludeHandlers) {
    modules.push('handlers');
  }

  write(outputDir, `utils.ts`, templates.utils);

  if (modules.includes('requests')) {
    write(outputDir, `requests.ts`, templates.requests);
  }

  if (modules.includes('handlers')) {
    write(outputDir, `handlers.ts`, templates.handlers.replace('$OPERATIONS',
        operationIds.map(id => `  ${id}: OperationHandler<T, '${id}'>;`).join('\n')));
  }

  write(outputDir, `index.ts`, templates.index + modules
      .map(module => `export * from './${module}';`)
      .join('\n'));

  console.log(`Types written to ${outputDir}`);
}
