import * as ts from 'typescript';

console.log(`Using TypeScript v${ts.version}`);

function findPath(operationId: string) {

}

export function getApiOperationIds(specTypesPath: string): string[] {
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

  return operationsInterface.members.map(m => (m.name as ts.Identifier).escapedText.toString());
}

