import * as OpenAPI from 'openapi-backend';

type Param = {
  in: string;
  name: string;
};

/**
 * An API operation
 */
export default class Operation {
  constructor(private readonly api: OpenAPI.OpenAPIBackend, private readonly op: OpenAPI.Operation) {
  }

  /**
   * The ID of this operation
   */
  get id() {
    return this.op.operationId;
  }

  /**
   * The HTTP method of this operation
   */
  get method() {
    return this.op.method;
  }

  /**
   * The relative path of this operation within the API
   */
  get path() {
    return this.op.path;
  }

  /**
   * The root path of the API containing this operation
   */
  get apiRoot() {
    return this.api.apiRoot;
  }


  /**
   * Build a URL for this operation with included path params.
   * @param [options] Options
   * @param [options.pathParams] Dictionary of path parameter names to values.
   *                             Required if the operation contains path parameters
   * @param [options.origin]     URL origin to append path to
   */
  buildUrl({pathParams = <Record<string, any>>{}, origin = ''} = {}) {
    const {api: {apiRoot}, op: {path, parameters}} = this;
    let builtPath = path;

    if (parameters) {
      for (const param of parameters as Param[]) {
        if (param.in === 'path') {
          const value = pathParams[param.name];

          if (value === undefined) {
            throw new Error(`Missing value for path parameter ${param.name}`);
          }

          builtPath = builtPath.replace(new RegExp(`\{${param.name}\}`, 'g'), value);
        }
      }
    }

    return `${origin}${apiRoot === '/' ? '' : apiRoot}${builtPath}`;
  }
}
