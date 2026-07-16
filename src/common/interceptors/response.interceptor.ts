import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiSuccess } from '../http/api-response';

/**
 * Wraps every successful controller return value in `{ success: true, data }`.
 * A handler that already returns a shaped `{ success: ... }` object is passed through untouched.
 *
 * Binary/file responses (StreamableFile, Buffer, streams) are passed through as-is: wrapping them
 * would make Nest JSON-serialize the payload, producing a corrupt download (e.g. the payslip PDF).
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiSuccess<T> | T> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccess<T> | T> {
    return next.handle().pipe(
      map((data) => {
        if (isBinary(data)) return data;
        if (data && typeof data === 'object' && 'success' in (data as Record<string, unknown>)) {
          return data;
        }
        return { success: true, data } as ApiSuccess<T>;
      }),
    );
  }
}

/** File/stream payloads that must reach the client byte-for-byte. */
function isBinary(data: unknown): boolean {
  return (
    data instanceof StreamableFile ||
    Buffer.isBuffer(data) ||
    // Node streams (e.g. a piped Readable) expose `pipe`.
    (typeof data === 'object' &&
      data !== null &&
      typeof (data as { pipe?: unknown }).pipe === 'function')
  );
}
