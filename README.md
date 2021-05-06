# openapi-ts-backend
Enables easy implementions of OpenAPI REST APIs in TypeScript with full typings of schemas and operations.

> Note: This module is deprecated and replaced by https://www.npmjs.com/package/@openapi-ts/backend which separates the core module from service bindings for AWS Lambda and Express.

## Introduction
This module allows for simple REST API implementation in TypeScript using OpenAPI 3.0 specifications. It can be easily integrated with any HTTP framework such as Express, AWS Lambda etc. 
A connector for AWS Lambda is provided within this module.

The module uses the excellent https://www.npmjs.com/package/openapi-backend module for routing and validation, and adds some useful features on top:

* Executable for generating TypeScript types for all schemas and operations. This is built on top of https://www.npmjs.com/package/openapi-typescript, and adds full types for all the operations specified in the API.
* Typed requests, responses etc, with headers and other parameters being coerced to fit the API schemas.
* Interceptors ("middleware") support
* Support for multiple OpenAPI specifications, mounted at different root paths.
* Simplified authorization
* Customizable response validation and trimming
* Simple error handling and customizable error response formatting

## Installation

```
$ npm install openapi-ts-backend
```

## Usage

### Simple Hello World API example:

Create API:
```
const api = new OpenApi()
  .register({
    definition: './greet-api.yml', // JSON or YAML
    operations: {
      // map of specification operationIds to handler functions
      greet: req => {
        return `Hello, ${req.params.name}!`;
      }, 
      ... 
    }
  });
```
Invoke API:
```
const res = await api.handleRequest({
  method: 'GET',
  path: '/greet/world',
  headers: {},
});
```

### Generating types for APIs

Consider this example API:

`greet-api.yml`
```
openapi: "3.0.0"
info:
  version: 1.0.0
  title: Greet API
components:
  securitySchemes:
    AccessToken:
      type: oauth2
      description: 'Validates a bearer token'
      flows:
        password:
          tokenUrl: 'https://api.example.com/oauth/token'
          scopes:
            full: Full access
            some: Some access
  schemas:
    Title:
      type: string
      enum:
        - Mr
        - Mrs
        - Miss
    Person:
      type: object
      description: A person
      required:
        - name
      properties:
        name:
          type: string
        title:
          $ref: '#/components/schemas/Title'
        photo:
          type: string
          format: byte
    Greeting:
      type: object
      required:
        - message
      properties:
        message:
          type: string
paths:
  /greet/{name}:
    get:
      operationId: greet
      summary: Greet the caller
      description: This greets the caller
      security:
        - AccessToken:
            - some
            - full
      parameters:
        - in: path
          name: name
          schema:
            type: string
          required: true
        - in: query
          name: title
          schema:
            $ref: '#/components/schemas/Title'
          description: Bar
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Greeting'
```

To generate TypeScript types for all requests and operation handlers, an executable is provided:
```
$ npx openapi-ts-backend generate-types greet-api.yml src/gen/greet-api
...
Types written to src/gen/greet-api
```

Now, types for all schemas and operations are generated in `src/gen/greet-api`, and a backend service can be set up type safely. 

### Example AWS Lambda API with typed operations

`src/api.ts`
```
import {LambdaOpenApi} from 'openapi-ts-backend';
import * as GreetApi from './gen/greet-api';

const operations: GreetApi.OperationHandlers<LambdaSource> = {
  greet: (req, res, params) => {
    const {params: {name}, query: {title}} = req; 

    // All request data is typed:
    // * req.params is {name: string}
    // * req.query is {title?: 'Mr' | 'Mrs' | 'Miss'}.
    // * Response body is {message: string} | void
    //   (all handlers may return void and mutate res instead)

    return {
      message: `Hello, ${title ? title + ' ' : ''}${name}!`;
    }
  }
};

const api = new LambdaOpenApi()
    .intercept(((req, res, params) => {
      console.log(`Event:`, params.data.lambda.event);
    }))
    .register({
      definition: './greet-api.yml',
      operations,
      path: '/'
    });
    
export default api.eventHandler();
```

The `OperationHandlers` interface contains all the operations specified by the OpenAPI specification, each one with typings for headers, path params, query params, cookies, bodies and responses, making it really easy to implement the API using TypeScript.

For simplicity, each operation may return a response body, or the provided res object may be mutated instead.
If the response object is not mutated and a body is returned, the response will use the returned value as the body.
The response status code is set by modifying `res.statusCode`, however as a convenience it may be omitted if the operation
only has a single defined successful status code. If statusCode is not set and there are multiple
successful status codes defined for the operation, a HTTP 500 error will be thrown.

Requests are always validated, and headers, path parameters, query parameters and cookies are parsed an coerced to 
the operation schema. If a request does not match the operation schema, a HTTP 400 response is
returned.

Responses are by default validated with errors simply logged. 
By using `responseValidationStrategy: 'throw'`, invalid responses will instead render HTTP 500 errors.

All error responses are customizable by supplying a custom `errorHandler` which maps thrown `Error` objects
to HTTP responses.

Each handler is invoked with a `params` object containing API data such as the operation,
authorizations etc. Custom data can be provided in `params` by supplying them to `handleRequest` and by specifying a custom
type parameter to the OpenApi constructor:

```
const api = new OpenApi<MyCustomData>().register(...);
api.handleRequest(req, myCustomData);
```

The `myCustomData` object will now be present in each handler as `params.data`.

### Interceptors

Interceptors are functions invoked on every request, similar to Express middleware.
Note that interceptors are invoked before requests are parsed and routed.

### Authorizers

Authorizers are functions implementing a security scheme as defined in the OpenAPI specification.
An authorizer function is called with the parsed request as input together with the scopes required
for the current operation (if applicable to the security scheme). The authorizer should either return some data,
such as a session or user object, or throw an error. If multiple security requirements are provided for an operation, 
only one must be successful.

