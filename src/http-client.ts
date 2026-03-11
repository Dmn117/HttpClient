import { FamilyOfBodies, type BodyParser, type HeaderInput, type RetryableBoom, type TimeoutController } from "./core/types.js";


export class HttpClient {

    //! Configurable by override

    protected static baseUrl = '';
    protected static retries = 2;
    protected static timeout = 1000;
    protected static retryDelay = 300;
    protected static defaultErrorMessage = 'Error en peticion HTTP';

    protected static retryMethods = ['GET', 'HEAD', 'OPTIONS'];

    protected static headers = (): Headers => new Headers({
        'Accept': 'application/json'
    });


    protected static async beforeRequest(init: RequestInit): Promise<RequestInit> {
        return init;
    }

    protected static async afterResponse(res: Response): Promise<Response> {
        return res;
    }

    protected static shouldRetry(method: string) {
        return this.retryMethods.includes(method.toUpperCase());
    }

    protected static computeBackoff (attempt: number): number {
        const base = this.retryDelay * Math.pow(2, attempt);
        const jitter = Math.random() * 100;
        return base + jitter;
    }

    protected static sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    protected static createTimeoutController (): TimeoutController {
        const controller = new AbortController();

        const timer = setTimeout(() => {controller.abort()}, this.timeout);

        return { controller, timer };
    }

    //! Core Request
    protected static async request<T>(method: string, url: string, body?: unknown, headers?: HeaderInput): Promise<T> {
        let attempt = 0;

        while (true) {
            const { controller, timer } = this.createTimeoutController();
        
            try {
                const init: RequestInit = {
                    method,
                    headers: this.mergeHeaders(headers),
                    signal: controller.signal
                };

                if (body !== undefined) init.body = JSON.stringify(body);

                const prepared = await this.beforeRequest(init);
                
                const res = await fetch(`${this.baseUrl}${url}`, prepared);
                
                const finalRes = await this.afterResponse(res);

                return await this.handlerResponse<T>(finalRes);
            }
            catch (error: any) {
                if (attempt < this.retries && error.retryable && this.shouldRetry(method)) {
                    const delay = this.computeBackoff(attempt);

                    attempt++;

                    await this.sleep(delay);

                    continue;
                }

                throw error;
            }
            finally {
                clearTimeout(timer);
            }
        }
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
    protected static mergeHeaders(extra?: HeaderInput): Headers {
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
    protected static async get<T>(url: string, headers?: HeaderInput) {
        return this.request<T>('GET', url, undefined, headers)
    }

    //? POST
    protected static async post<T>(url: string, body: unknown, headers?: HeaderInput) {
        return this.request<T>('POST', url, body, headers);
    }

    //? PUT
    protected static async put<T>(url: string, body: unknown, headers?: HeaderInput) {
        return this.request<T>('PUT', url, body, headers);
    }

    //? PATCH
    protected static async patch<T>(url: string, body: unknown, headers?: HeaderInput) {
        return this.request<T>('PATCH', url, body, headers);
    }

    //? DELETE
    protected static async delete<T>(url: string, body: unknown, headers?: HeaderInput) {
        return this.request<T>('DELETE', url, body, headers);
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


    //! Reusable Hooks

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