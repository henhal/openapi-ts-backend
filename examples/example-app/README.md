# OpenApi Lambda backend example using TypeScript and Serverless 

An example API using LambdaOpenAPI and serverless-bundle

* Uses an OpenAPI spec in `.yml` format

* Generates TS types from the OpenAPI spec 

  `$ yarn run api:types`

* Adds an example endpoint and an example authorizer

* Packages TypeScript code into bundle using serverless-bundle

* Has tools to generate docs from the spec

  `$ yarn run api:docs`

* Has tools to invoke the function locally for testing

  `$ yarn invoke-local src/functions/example/index.default GET /greet/world '{"content-type":"application/json","authorization":"Bearer SOME"}'`

