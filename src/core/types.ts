

export interface RetryableBoom extends Error {
  retryable?: boolean;
}

export interface TypedHeaders {
    'Content-Type'?:
    | 'application/json'
    | 'multipart/form-data'
    | 'application/xml';

    'Accept'?:
    | 'application/json'
    | 'text/plain'
    | '*/*';

    'Authorization'?: `Bearer ${string}`;

    'X-Request-Id'?: string;
    'X-Trace-Id'?: string;

    [key: string]: string | undefined;
}

export type HeaderInput = Headers | TypedHeaders | [string, string][];

export type BodyParser = (res: Response) => Promise<any>;

export enum FamilyOfBodies {
    json = 'json',
    text = 'text',
    xml = 'xml',
    multipart = 'multipart',
    binary = 'binary',
    form = 'form',
}

export interface TimeoutController {
    controller: AbortController;
    timer: NodeJS.Timeout;
} 