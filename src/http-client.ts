import { FamilyOfBodies, HttpMethod, type BodyParser, type HeaderInput, type HttpContext, type HttpMiddleware, type RetryableBoom, type TimeoutController } from "./core/types.js";
import { HttpMiddlewares } from "./middlewares/http-middlewares.js";


export class HttpClient {

    //! Configurable by override

    protected static baseUrl = '';
    protected static defaultErrorMessage = 'Error en peticion HTTP';

    protected static headers = (): Headers => new Headers({
        'Accept': 'application/json'
    });


    //! Middlware registries

    private static globalMiddlewares: HttpMiddleware[] = [];

    private static clientMiddlewares = new Map<Function, HttpMiddleware[]>();

    
    //! Middleware registration

    public static useGlobal(middleware: HttpMiddleware): void {
        this.globalMiddlewares.push(middleware);
    }

    public static use(middleware: HttpMiddleware): void {
        const stack = this.getClientStack();

        stack.push(middleware);
    }

    protected static getClientStack(): HttpMiddleware[] {
        if (!this.clientMiddlewares.has(this)) 
            this.clientMiddlewares.set(this, []);

        return this.clientMiddlewares.get(this)!;
    }

    protected static buildStack(requestStack: HttpMiddleware[] = []): HttpMiddleware[] {
        const clientStack = this.getClientStack();

        return [
            ...HttpClient.globalMiddlewares,
            ...clientStack,
            ...requestStack
        ];
    }


    //! Middleware Pipeline

    protected static async runPipeline(ctx: HttpContext, requestStack?: HttpMiddleware[]): Promise<Response> {
        const stack = this.buildStack(requestStack);

        let index = -1;

        const dispatch = async (i: number): Promise<Response> => {
            if (i <= index)
                throw new Error("next() called multiple times");

            index = i;

            const middleware = stack[i];

            if (!middleware) 
                return fetch(`${this.baseUrl}${ctx.url}`, ctx.init);

            return middleware(ctx, () => dispatch(i + 1));
        }

        return dispatch(0);
    }


    //! Core Request
    protected static async request<T>(method: HttpMethod, url: string, body?: unknown, headers?: HeaderInput, middlewares?: HttpMiddleware[]): Promise<T> {
        const init: RequestInit = {
            method,
            headers: this.mergeHeaders(headers)
        };

        if (body !== undefined) 
            init.body = JSON.stringify(body);

        const ctx: HttpContext = {
            url,
            method,
            attempt: 0,
            init
        };

        const res = await this.runPipeline(ctx, middlewares);

        ctx.response = res;

        return await this.handlerResponse(res);
    }


    protected static getContetType(res: Response): string {
        const header = res.headers.get("content-type");
        const contentType = header
            ? header.split(";")[0]?.trim().toLowerCase() ?? ''
            : '';

        return contentType;
    }


    protected static async formParser(res: Response) {
        const text = await res.text();
        return new URLSearchParams(text);
    }


    protected static familyParsers: Record<FamilyOfBodies, BodyParser> = {
        json: (res) => res.json(),
        text: (res) => res.text(),
        xml: (res) => res.text(),
        multipart: (res) => res.formData(),
        binary: (res) => res.arrayBuffer(),
        form: this.formParser,
    }


    protected static getMimeFamily(contentType: string): FamilyOfBodies | null {
        if (!contentType) return null;

        if (
            contentType === "application/json" ||
            contentType.endsWith("+json")
        ) return FamilyOfBodies.json;

        if (
            contentType.startsWith("text/")
        ) return FamilyOfBodies.text;

        if (
            contentType.includes("xml")
        ) return FamilyOfBodies.xml;

        if (
            contentType === "application/x-www-form-urlencoded"
        ) return FamilyOfBodies.form;

        if (
            contentType.startsWith("multipart/")
        ) return FamilyOfBodies.multipart;

        if (
            contentType.startsWith("image/") ||
            contentType.startsWith("audio/") ||
            contentType.startsWith("video/") ||
            contentType === "application/octet-stream" ||
            contentType === "application/pdf" ||
            contentType === "application/zip"
        ) return FamilyOfBodies.binary;

        return null;
    }


    //! Header Merge (Not override)
    private static mergeHeaders(extra?: HeaderInput): Headers {
        const headers = this.headers();

        if (!extra) return headers;

        if (extra instanceof Headers) {
            extra.forEach((v, k) => headers.set(k, v));
            return headers;
        }

        if (Array.isArray(extra)) {
            extra.forEach(([k, v]) => headers.set(k, v));
            return headers;
        }

        for (const [k, v] of Object.entries(extra)) {
            if (v != null) headers.set(k, v);
        }

        return headers;
    }

    //! HTTP Verbs (Not override)

    //? GET
    protected static async get<T>(url: string, headers?: HeaderInput, middlewares?: HttpMiddleware[]) {
        return this.request<T>(HttpMethod.GET, url, undefined, headers, middlewares)
    }

    //? POST
    protected static async post<T>(url: string, body: unknown, headers?: HeaderInput, middlewares?: HttpMiddleware[]) {
        return this.request<T>(HttpMethod.POST, url, body, headers, middlewares);
    }

    //? PUT
    protected static async put<T>(url: string, body: unknown, headers?: HeaderInput, middlewares?: HttpMiddleware[]) {
        return this.request<T>(HttpMethod.PUT, url, body, headers, middlewares);
    }

    //? PATCH
    protected static async patch<T>(url: string, body: unknown, headers?: HeaderInput, middlewares?: HttpMiddleware[]) {
        return this.request<T>(HttpMethod.PATCH, url, body, headers, middlewares);
    }

    //? DELETE
    protected static async delete<T>(url: string, body: unknown, headers?: HeaderInput, middlewares?: HttpMiddleware[]) {
        return this.request<T>(HttpMethod.DELETE, url, body, headers, middlewares);
    }


    //! Response handling (overrideable)

    protected static async handlerResponse<T>(res: Response): Promise<T> {
        const body = await this.getBody(res);

        if (res.ok) return body;

        const message = this.getMessage(body) || this.defaultErrorMessage;

        const error: RetryableBoom = new Error(message);

        error.retryable = res.status === 429 || res.status >= 500;

        throw error;
    }


    //! Body extraction

    protected static async getBody(res: Response): Promise<any> {
        const contentType = this.getContetType(res);
        const family = this.getMimeFamily(contentType);

        if (family) return this.familyParsers[family](res);

        try {
            return await res.text();
        } catch {
            return res.arrayBuffer();
        }
    };


    //! Message extraction

    protected static getMessage(body: any): string | undefined {
        if (typeof body === 'string') return body;

        if (typeof body === 'object') {
            if (body.message) return body.message;
        }

        if (Array.isArray(body)) {
            const first = body[0];

            if (first.description) return first.description;

            if (first.message) return first.message;
        }


        if (body.errors) {
            if (Array.isArray(body.errors)) {
                const first = body.errors[0];

                if (first.message) return first.message;
            }
        }
    };
}

