import {HttpError, LambdaOpenApi, LambdaSource, Request, SecurityRequirement} from 'openapi-ts-backend';

import {Operations} from 'gen/example-api';

const {PWD: ROOT_PATH} = process.env;

type Context = {
  models: any;
};

type AuthSession = {
  user: {
    name: string;
  };
  scopes: string[];
};

// type Operation<ReqBody, ResBody> = LambdaOperationHandler<Context, Request<ReqBody>, Response<ResBody>>;
//
// type Operations = {
//   greet: Operation<ExampleApi.GreetRequest, ExampleApi.GreetResponse>;
//   hello: Operation<void, ExampleApi.GreetResponse>;
// };

// class HttpError extends Error {
//   constructor(message: string, readonly statusCode = 500) {
//     super(message);
//   }
// }

async function createContextAsync(): Promise<Context> {
  return {
    // any additional data to be included as params to every request
      models: 'FOO'
  };
}

const DEBUG_SESSIONS: Record<string, AuthSession> = {
  FULL: {
    user: {
      name: 'Alice'
    },
    scopes: ['full']
  },
  SOME: {
    user: {
      name: 'Bob'
    },
    scopes: ['some']
  },
  NONE: {
    user: {
      name: 'Charlie'
    },
    scopes: ['bogus']
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
          requiredScopes
        });
  }
}

function authorize<T>(req: Request, requirement: SecurityRequirement): AuthSession {
  console.debug(`Authorize`, requirement);
  const header = req.headers?.['authorization'];

  if (typeof header !== 'string') {
    throw new HttpError('Missing token', 401);
  }

  const session = verifyAccessToken(header.substring('Bearer '.length));
  console.debug(`Session:`, session)
  // Verify scopes required for the current operation against scopes granted by the token
  const requiredScopes = requirement.parameters.scopes;

  console.debug(`Operation requires scopes ${requiredScopes}`);
  if (requiredScopes) {
    verifyScopes(session.scopes, requiredScopes);
  }

  return session;
}

const definition = `${ROOT_PATH}/definition/example-api/api.yml`;

console.debug(`Using OpenAPI document ${definition}`);

type CustomParams = unknown;

const operations: Operations<LambdaSource & CustomParams> = {
  greet: (req, res, params) => {
    console.log(req);
    const {person} = req.body;
    const hhh = req.headers;
    const aaa = req.headers.abc;
    const bbb = req.headers.foo;
    const ccc = res.headers.baz;


    res.headers.baz = 42;
    res.headers.abc = 44;
    res.headers.asjkajsktja='gll';

    if (!person.name.length) {
      throw new HttpError(`Don't be a stranger!`, 400);
    }

    return {
      message: `Hello, ${person.name}!`,
      qux: 42
    };
  },
  hello: async (req, res, params) => {
    const hhh = req.headers;
    const abcd = hhh.abcd;
    res.statusCode = 200;

    return {
      message: `Hello, ${req.params.name}`,
      foo: 'bar'
    };
  },
};

export default new LambdaOpenApi<CustomParams>()
    .intercept(((req, res, params) => {
      console.log(`Event:`, params.data.lambda.event);
    }))
    .register({
      definition,
      authorizers: {
        AccessToken: (req, res, params, requirement ) => {
          //console.debug(`AccessToken: res=${JSON.stringify(res)}`);
          return authorize(req, requirement);
        }
      },
      operations,
      path: '/'
    }).eventHandler();
