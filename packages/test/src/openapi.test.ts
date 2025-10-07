import {HttpError, OpenApi} from "@a-labs-io/openapi-ts-backend";
import { OperationHandlers} from './gen';

function greet(title: string, name: string): string {
  return `Hello, ${title}${title ? ' ' : ''}${name}`;
}

function getTypeMap(obj: any) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, typeof v]));
}

const operations: OperationHandlers<unknown> = {
  greet: req => {
    const {params: {name}, query: {title = ''}} = req;

    return {
      message: greet(title, name),
    };
  },
  addPerson: req => {
    return req.body.person;
  },
  getTypes: req => {
    return {
      params: getTypeMap(req.params),
      headers: getTypeMap(req.headers),
      query: getTypeMap(req.query),
      cookies: getTypeMap(req.cookies),
    }
  },
  deletePerson: () => {
    return;
  }
};

describe('API tests', () => {
  const api = new OpenApi()
      .register({
        definition: './api.yml',
        operations,
        authorizers: {
          AccessToken: req => {
            if (req.headers.authorization) {
              return {};
            } else {
              throw new HttpError('Boo!', 401);
            }
          },
        },
      });

  it('Should handle a valid request with implicit status 200', async () => {
    const res = await api.handleRequest({
      method: 'GET',
      path: '/greet/John%20Doe',
      headers: {
        authorization: 'true',
      },
      query: {
        title: 'Mr'
      }
    });
    expect(res.statusCode).toEqual(200);
  });

  it('Should handle a valid request with implicit status 201', async () => {
    const res = await api.handleRequest({
      method: 'POST',
      path: '/persons',
      headers: {
        authorization: 'true',
      },
      body: {
        person: {
          name: 'John Doe'
        }
      }
    });
    expect(res.statusCode).toEqual(201);
  });

  it('Should return 401 for unauthorized request', async () => {
    const res = await api.handleRequest({
      method: 'Get',
      path: '/greet/John%20Doe',
      headers: {},
      query: {}
    });

    expect(res.statusCode).toEqual(401);
  });

  it('Should return 404 for invalid path', async () => {
    const res = await api.handleRequest({
      method: 'GET',
      path: '/foobar',
      headers: {},
      query: {},
    });

    expect(res.statusCode).toEqual(404);
  });

  it('Should coerce params', async () => {
    const res = await api.handleRequest({
      method: 'GET',
      path: '/types/1',
      headers: {
        baz: '3',
        cookie: 'qux=4'
      },
      query: {
        bar: '2'
      },
    });

    // This echoes the type of all supplied headers

    expect(res.statusCode).toEqual(200);
    expect(res.body).toEqual({
      params: {foo: 'number'},
      query: {bar: 'number'},
      headers: {baz: 'number', 'cookie': 'string'},
      cookies: {qux: 'number'}
    });
  });

  it('Should fail to coerce invalid params', async () => {
    // Params are not coercable to numbers
    const res = await api.handleRequest({
      method: 'GET',
      path: '/types/INVALID',
      headers: {
        baz: 'INVALID',
        cookie: 'qux=INVALID'
      },
      query: {
        bar: 'INVALID'
      },
    });

    expect(res.statusCode).toEqual(400);
    const errors = (res.body as any)?.data?.errors;
    expect(errors).toBeDefined();
    expect(errors[0].message).toContain('/path/foo must be number');
  });
});