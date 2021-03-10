import {OpenApi} from '../openapi';

import {Operations} from './gen';
import {HttpError} from '../errors';

function greet(title: string, name: string): string {
  return `Hello, ${title}${title ? ' ' : ''}${name}`;
}

function getTypeMap(obj: any) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, typeof v]));
}

const operations: Operations<unknown> = {
  hello: (req, res, params) => {
    const {params: {name}, query: {title = ''}} = req;
    return {
      message: greet(title, name),
    };
  },
  greet: (req, res) => {
    const {body: {person: {title = '', name}}} = req;

    return {
      message: greet(title, name),
    };
  },
  getTypes: req => {
    return {
      params: getTypeMap(req.params),
      headers: getTypeMap(req.headers),
      query: getTypeMap(req.query),
      cookies: getTypeMap(req.cookies),
    }
  }
};

describe('API tests', () => {
  const api = new OpenApi()
      .register({
        definition: './src/test/api.yml',
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

  it('Should handle a valid request', async () => {
    const res = await api.handleRequest({
      method: 'GET',
      path: '/greet/John',
      // TODO make headers optional in RawRequest?
      headers: {
        authorization: 'true',
      },
      query: {},
    });
    expect(res.statusCode).toEqual(200);
  });

  it('Should fail an unauthorized request', async () => {
    const res = await api.handleRequest({
      method: 'GET',
      path: '/greet/John',
      headers: {},
      query: {},
    });

    expect(res.statusCode).toEqual(401);
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

    expect(res.statusCode).toEqual(200);
    expect(res.body).toEqual({
      params: {foo: 'number'},
      query: {bar: 'number'},
      headers: {baz: 'number', 'cookie': 'string'},
      cookies: {qux: 'number'}
    });
  });
});