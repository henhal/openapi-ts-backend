import * as Lambda from 'aws-lambda';
import querystring from 'querystring';
const args = process.argv.slice(2);

if (args.length < 4) {
  // noinspection RequiredAttributes
  console.error(`Usage: call <function> <method> <path[?<querystring>]> <headers> [<body>]`);
  process.exit(1);
}

const [func, httpMethod, url, headers, body] = args;

function parseJson(jsonLike: string): unknown {
  return eval(`(${jsonLike  })`);
}

function formatHeaders(headers: Record<string, unknown>) {
  const lines = Object.entries(headers || {}).map(([k, v]) => `${k}: ${v}`);

  return lines.length ? lines.join('\n') + '\n' : '';
}

function formatJson(json: string) {
  return JSON.stringify(JSON.parse(json), null, 2);
}

async function invokeHandler() {
  const [path, query] = url.split('?');
  const event = {
    path,
    httpMethod,
    body: JSON.stringify(parseJson(body)),
    headers: parseJson(headers),
    multiValueHeaders: {},
    queryStringParameters: {...querystring.parse(query)}
  } as Lambda.APIGatewayEvent;
  const context = {} as Lambda.Context;
  const [p, n] = func.split('.');

  console.log(`Using handler function ${n} from ${p}`);
  const handler = (await import(`../${p}`))[n];

  const result = await (handler(event, context, undefined as unknown) as Promise<Lambda.APIGatewayProxyResult>);

  console.log(
      `HTTP ${result.statusCode}\n` +
      `${formatHeaders(result.headers || {})}` +
      `\n` +
      `${formatJson(result.body)}`);
}

invokeHandler().catch(console.error);


