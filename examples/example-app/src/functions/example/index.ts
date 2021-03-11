import {
  HttpError,
  LambdaOpenApi,
  LambdaSource,
  OpenApi,
  RawRequest,
  Request,
  SecurityRequirement,
} from 'openapi-ts-backend';

import {OperationHandlers} from 'gen/example-api';

const {PWD: ROOT_PATH} = process.env;

type AuthSession = {
  user: {
    name: string;
  };
  scopes: string[];
};

const DEBUG_SESSIONS: Record<string, AuthSession> = {
  FULL: {
    user: {
      name: 'Alice',
    },
    scopes: ['full'],
  },
  SOME: {
    user: {
      name: 'Bob',
    },
    scopes: ['some'],
  },
  NONE: {
    user: {
      name: 'Charlie',
    },
    scopes: ['bogus'],
  },
};

function verifyAccessToken(jwt: string): AuthSession {
  // This is just fake.
  if (jwt in DEBUG_SESSIONS) {
    return DEBUG_SESSIONS[jwt];
  }
  console.log('no token')
  throw new HttpError(`Invalid token`, 401);
}

function verifyScopes(grantedScopes: string[], requiredScopes: string[]) {
  if (!requiredScopes.some(scope => grantedScopes.includes(scope))) {
    throw new HttpError(
        `Insufficient scope, need at least one of: ${requiredScopes.map(scope => `'${scope}'`).join(', ')}`,
        403,
        {
          requiredScopes,
        });
  }
}

function authorize<T>(req: Request, requirement: SecurityRequirement): AuthSession {
  console.debug(`Authorize: `, requirement);
  const header = req.headers?.['authorization'];

  if (typeof header !== 'string') {
    throw new HttpError('Missing token', 401);
  }

  const session = verifyAccessToken(header.substring('Bearer '.length));
  console.debug(`Session:`, session)
  // Verify scopes required for the current operation against scopes granted by the token
  const requiredScopes = requirement.parameters.scopes;

  console.debug(`Operation requires scopes ${JSON.stringify(requiredScopes)}`);
  if (requiredScopes) {
    verifyScopes(session.scopes, requiredScopes);
  }

  return session;
}

const definition = `${ROOT_PATH}/definition/example-api/api.yml`;

console.debug(`Using OpenAPI document ${definition}`);

type CustomParams = unknown;

const operations: OperationHandlers<LambdaSource & CustomParams> = {
  greet: (req, res, params) => {
    const {name} = req.params;

    if (!name.length) {
      throw new HttpError(`Don't be a stranger!`, 400);
    }

    return {
      message: `Hello, ${name}!`,
    };
  },
};

export default new LambdaOpenApi<CustomParams>()
    .intercept(((req, res, params) => {
      console.log(`Lambda event:`, params.data.lambda.event);
    }))
    .register({
      definition,
      authorizers: {
        AccessToken: (req, res, params, requirement) => {
          return authorize(req, requirement);
        },
      },
      operations,
      path: '/',
    }).eventHandler();


new OpenApi<{foo:string}>().handleRequest({} as RawRequest, {foo:'hello'})