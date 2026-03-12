import { HttpMethod, type HttpMiddleware } from "../core/types.js";

export class HttpMiddlewares {

    //! Utils
    private static sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private static fingerprint(ctx: any): string {
        const body =
            typeof ctx.init.body === "string"
                ? ctx.init.body
                : "";

        return `${ctx.method}:${ctx.url}:${body}`;
    }


    //! Request Deduplication
    public static requestDeduplication = (): HttpMiddleware => {
        const inflight = new Map<string, Promise<Response>>();

        return async (ctx, next) => {
            if (ctx.method !== HttpMethod.GET) {
                return next();
            }

            const key = this.fingerprint(ctx);

            if (inflight.has(key)) {
                return inflight.get(key)!;
            }

            const promise = next().finally(() => inflight.delete(key));

            inflight.set(key, promise);

            return promise;
        };
    };


    //! Concurrency limiter
    public static concurrency = (limit: number): HttpMiddleware => {
        let active = 0;
        const queue: (() => void)[] = [];

        const nextSlot = () => {
            if (queue.length && active < limit) {
                active++;
                queue.shift()!();
            }
        };

        return async (ctx, next) => {
            if (active >= limit)
                await new Promise<void>(resolve => queue.push(resolve));

            active++;

            try {
                return await next();
            } finally {
                active--;
                nextSlot();
            }
        };
    };


    //! Basic Cache
    public static cache = (ttl = 500): HttpMiddleware => {
        const cache = new Map<string, { expires: number; response: Response }>();

        return async (ctx, next) => {
            if (ctx.method !== HttpMethod.GET)
                return next();

            const key = this.fingerprint(ctx);
            const cached = cache.get(key);

            if (cached && cached.expires > Date.now())
                return cached.response.clone();

            const res = await next();

            if (res.ok) {
                cache.set(key, {
                    expires: Date.now() + ttl,
                    response: res.clone()
                });
            }

            return res;
        };
    };


    //! Retry with exponential backoff
    public static retry = (retries = 2, baseDelay = 300): HttpMiddleware => {
        return async (ctx, next) => {
            let attempt = 0;

            while (true) {
                try {
                    ctx.attempt = attempt;

                    const res = await next();

                    if (res.status >= 500 && attempt < retries) {
                        const delay = baseDelay * Math.pow(2, attempt);

                        await this.sleep(delay);

                        attempt++;
                        continue;
                    }

                    return res;

                } catch (error: any) {

                    if (!error?.retryable || attempt >= retries)
                        throw error;

                    const delay = baseDelay * Math.pow(2, attempt);

                    await this.sleep(delay);

                    attempt++;
                }
            }
        };
    };


    //! Timeout
    public static timeout = (timeout = 2000): HttpMiddleware => {
        return async (ctx, next) => {

            const controller = new AbortController();

            const timer = setTimeout(() => {
                controller.abort();
            }, timeout);

            ctx.init.signal = controller.signal;

            try {
                return await next();
            }
            finally {
                clearTimeout(timer);
            }
        };
    };


    //! Request ID
    public static requestId = (): HttpMiddleware => {
        return async (ctx, next) => {
            const headers = ctx.init.headers as Headers;
            
            const existing = headers.get("x-request-id");

            const id = existing ?? crypto.randomUUID();

            ctx.meta ??= {};
            ctx.meta.requestId = id;

            headers.set("x-request-id", id);

            return next();
        };
    };


    //! Timing / Metrics
    public static timing = (): HttpMiddleware => {
        return async (ctx, next) => {

            const start = performance.now();

            const res = await next();

            const duration = performance.now() - start;

            console.log(
                `[HTTP] ${ctx.method} ${ctx.url} - ${duration.toFixed(2)}ms`
            );

            return res;
        };
    };


    //! Bearer Auth
    public static authBearer = (token: string): HttpMiddleware => {
        return async (ctx, next) => {

            const headers = ctx.init.headers as Headers;

            headers.set("Authorization", `Bearer ${token}`);

            return next();
        };
    };


    //! Advanced Cache (Stale While Revalidate)
    public static staleWhileRevalidate = (ttl = 5000): HttpMiddleware => {

        const cache = new Map<string, {
            expires: number;
            response: Response;
        }>();

        return async (ctx, next) => {

            if (ctx.method !== HttpMethod.GET)
                return next();

            const key = this.fingerprint(ctx);
            const cached = cache.get(key);

            if (cached) {

                if (cached.expires > Date.now()) {
                    return cached.response.clone();
                }

                // stale → devolver viejo y refrescar en background
                next().then(res => {
                    if (res.ok) {
                        cache.set(key, {
                            expires: Date.now() + ttl,
                            response: res.clone()
                        });
                    }
                });

                return cached.response.clone();
            }

            const res = await next();

            if (res.ok) {
                cache.set(key, {
                    expires: Date.now() + ttl,
                    response: res.clone()
                });
            }

            return res;
        };
    };

}