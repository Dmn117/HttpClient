import { HttpMethod, type HttpMiddleware } from "../core/types.js";



export class HttpMiddlewares {


    public static requestDeduplication = (): HttpMiddleware => {
        const inflight = new Map<string, Promise<Response>>();

        return async (ctx, next) => {
            if (ctx.method !== HttpMethod.GET) {
                return next();
            }

            const key = `${ctx.method}:${ctx.url}`;

            if (inflight.has(key)) {
                return inflight.get(key)!;
            }

            const promise = next().finally(() => inflight.delete(key));

            inflight.set(key, promise);

            return promise;
        }
    }


    // public static concurrency = (limit: number): HttpMiddleware => {
    //     let active = 0;
    //     const queue: (() => void)[] = [];

    //     const nextSlot = () => {
    //         if (queue.length && active < limit) {
    //             active++;
    //         }
    //     }
    // }


    // public static cache = (ttl = 500): HttpMiddleware => {
    //     const cache
    // }
}