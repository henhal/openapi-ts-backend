// import {Awaitable, Interceptor, RequestParams} from './types';
//
// /**
//  * A convenience function to create an interceptor that attaches custom params.
//  * Each argument should be an object that will be copied into the params passed to all requests.
//  * Since interceptors are needed synchronously at applications startup but interceptors themselves are asynchronous,
//  * this function supports passing promised objects as well.
//  *
//  * @param sources Objects (or promises resolving into objects) to attach to the params
//  * sent to every request
//  * @return Interceptor function
//  */
// export function attachParams<P extends RequestParams>(...sources: Array<Awaitable<object>>): Interceptor<P> {
//   // Memoize the promises
//   const sourcePromises = Promise.all(sources);
//
//   return async (req, res, params) => {
//     Object.assign(params, ...await sourcePromises);
//   };
// }