import * as Lambda from 'aws-lambda';

import {OpenApi} from '../../openapi';
import {OperationHandler, RawRequest, RawResponse, Request, RequestParams, Response} from '../../types';

function parseJson(body: string | null): any {
  // Try to parse the body as JSON. If it's malformed, we return the raw string as the body to get a useful
  // error message from the API validator.
  try {
    return body ? JSON.parse(body) : undefined;
  } catch (err) {
    return body;
  }
}

// https://github.com/DefinitelyTyped/DefinitelyTyped/pull/50224 ¯\_(ツ)_/¯
function trimRecord<K extends string, V>(obj: Record<K, V | undefined | null>): Record<K, V> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null)) as Record<K, V>;
}

/**
 * AWS Lambda specific request parameters
 * @property event    The Lambda event
 * @property context  The Lambda context
 */
export type LambdaSource = {
  lambda: {
    event: Lambda.APIGatewayEvent;
    context: Lambda.Context;
  };
};

export type LambdaRequestParams<C = unknown> = RequestParams<LambdaSource, C>;

/**
 * AWS Lambda operation handler
 */
export type LambdaOperationHandler<P extends LambdaRequestParams = LambdaRequestParams,
    Req extends Request = Request,
    Res extends Response = Response> = OperationHandler<P, Req, Res>;

/**
 * A HTTP API using an OpenAPI definition and implemented using AWS Lambda.
 */
export class LambdaOpenApi<C> extends OpenApi<LambdaSource, C> {
  protected fromLambdaEvent(event: Lambda.APIGatewayEvent): RawRequest {
    return {
      method: event.httpMethod,
      path: event.path,
      query: trimRecord(event.queryStringParameters || {}),
      headers: trimRecord({
        ...event.headers,
        ...event.multiValueHeaders
      }), // TODO could headers and MVH contain same keys, and should we then merge?
      // //params: trimRecord(event.pathParameters || {}),
      body: parseJson(event.body),
    };
  }

  protected toLambdaResult(res: RawResponse): Lambda.APIGatewayProxyResult {
    const statusCode = res.statusCode;
    const headers: Record<string, string> = {};
    const multiValueHeaders: Record<string, string[]> = {};
    const body = JSON.stringify(res.body);

    // Lambda separates ordinary headers and multi value headers
    for (const [k, v] of Object.entries(res.headers)) {
      if (Array.isArray(v)) {
        multiValueHeaders[k] = v.map(x => x.toString());
      } else if (v !== undefined) {
        headers[k] = v.toString();
      }
    }

    return {
      statusCode,
      headers,
      multiValueHeaders,
      body,
    };
  }

  /**
   * Creates a lambda HTTP event handler function which will route and handle requests using this class
   * and transform the response into a lambda HTTP event response.
   * The request and response body will be converted from/to JSON.
   *
   * @return A lambda event handler function
   */
  eventHandler(): Lambda.APIGatewayProxyHandler {
    return async (event: Lambda.APIGatewayEvent, context: Lambda.Context) => {
      this.logger.debug(`Lambda event:\n${JSON.stringify(event, null, 2)}`);

      const res = await this.handleAsync(
          this.fromLambdaEvent(event),
          {
            lambda: {
              event,
              context
            }
          });

      return this.toLambdaResult(res);
    }
  }
}
