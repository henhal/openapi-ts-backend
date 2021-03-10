import {OpenApi} from '../openapi';

import {Operations} from './gen';

function greet(title: string, name: string): string {
  return `Hello, ${title}${title ? ' ' : ''}${name}`;
}

const operations: Operations<unknown> = {
  hello: (req, res, params) => {
    const {params: {name}, query: {title = ''}} = req;
    return {
      message: greet(title, name)
    };
  } ,
  greet: (req, res) => {
    const {body: {person: {title = '', name}}} = req;

    return {
      message: greet(title, name)
    };
  }
};

describe('API tests', () => {
  it('Should handle a valid request', async () => {
    const api = new OpenApi()
        .register({
          definition: './src/test/api.yml',
          operations,
          authorizers: {
            AccessToken: req => req.headers.authorization === 'true'
          }
        });

    const res = await api.handleRequest({
      method: 'GET',
      path: '/greet/John',
      headers: {
        authorization: 'true'
      }, // TODO make headers optional in RawRequest?
      query: {}
    });

    console.log(res);
    expect(res.statusCode).toEqual(200);
  });
});