import * as ts from 'typescript';
import * as yaml from 'js-yaml';
import generateOpenApiTypes from 'openapi-typescript';
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'fs';
import path from 'path';

const YAML_EXTENSION = /\.ya?ml$/;

const [inputFile, outputDir] = process.argv.slice(2);

if (!inputFile || !outputDir) {
  console.error(`Usage: typegen.ts <path to OpenAPI document> <output directory>`);
  process.exit(1);
}

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

function getApiOperationIds(specTypesPath: string) {
  const program = ts.createProgram([specTypesPath], {});
  const tsFile = program.getSourceFile(specTypesPath);

  if (!tsFile) {
    throw new Error(`Cannot find OpenAPI types ${specTypesPath}`);
  }

  const operationsNode = tsFile
      .getChildAt(0)
      .getChildren()
      .find(c =>
          c.kind === ts.SyntaxKind.InterfaceDeclaration &&
          (c as ts.InterfaceDeclaration).name.escapedText === 'operations');

  if (!operationsNode) {
    throw new Error(`Could not find operations interface`);
  }

  const operationsInterface = operationsNode as ts.InterfaceDeclaration;

  return operationsInterface.members.map(m => (m.name as ts.Identifier).escapedText);
}

const HELPERS = `
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

const OPERATIONS = `
import {OperationHandler, Params, Request, Response} from 'openapi-ts-backend';
import {operations} from './spec';
import {RequestBody, RequestHeaders, RequestPathParams, RequestQuery, ResponseBody, ResponseHeaders} from './helpers';

export type OperationRequest<OperationId extends keyof operations> =
    Request<
        RequestBody<OperationId>, 
        Params & RequestPathParams<OperationId>, 
        Params & RequestQuery<OperationId>, 
        Params & RequestHeaders<OperationId>>;

export type OperationResponse<OperationId extends keyof operations> =
    Response<
        ResponseBody<OperationId>, 
        Params & ResponseHeaders<OperationId>>;

export type Operation<P, OperationId extends keyof operations> =
    OperationHandler<P,
        OperationRequest<OperationId>,
        OperationResponse<OperationId>>;
`;

if (!existsSync(outputDir)) {
  mkdirSync(outputDir);
}
createSpecTypes(inputFile, outputDir).then(specTypesPath => {
  const operationIds = getApiOperationIds(specTypesPath);

  write(outputDir, `helpers.ts`, HELPERS);
  write(outputDir, `operations.ts`, OPERATIONS);
  write(outputDir, `index.ts`, `` +
      `import {OperationHandler, Request, Response} from 'openapi-ts-backend';\n` +
      `import {Operation} from './operations';\n` +
      `import {components} from './spec';\n\n` +
      `export interface Operations<P>\n` +
      `    extends Record<string, OperationHandler<P, Request<any, any, any, any>, Response<any, any>>> {\n` +
      `${operationIds.map(id => `  ${id}: Operation<P, '${id}'>;`).join('\n')}\n` +
      `}\n\n` +
      `export type Schemas = components['schemas'];`);
});
