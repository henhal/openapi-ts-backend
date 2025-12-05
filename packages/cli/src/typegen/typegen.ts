import openapiTS, { astToString } from "openapi-typescript";
import {writeFileSync, mkdirSync, existsSync} from 'fs';
import path from 'path';

import {getApiOperationIds} from './parser';
import * as templates from './templates';
import {pathToFileURL} from "node:url";

function write(dirName: string, fileName: string, data: string) {
  const outputPath = path.resolve(dirName, fileName);

  writeFileSync(outputPath, data);

  return outputPath;
}

async function createSpecTypes(specPath: string, outputDir: string) {
  const absolutePath = path.resolve(specPath);
  const url = pathToFileURL(absolutePath)
  const ast = await openapiTS(url);
  const ts = astToString(ast);

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
