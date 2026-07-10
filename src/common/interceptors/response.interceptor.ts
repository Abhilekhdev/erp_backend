import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiSuccess } from '../http/api-response';

/**
 * Wraps every successful controller return value in `{ success: true, data }`.
 * A handler that already returns a shaped `{ success: ... }` object is passed through untouched.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiSuccess<T> | T> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccess<T> | T> {
    return next.handle().pipe(
      map((data) => {
        if (data && typeof data === 'object' && 'success' in (data as Record<string, unknown>)) {
          return data;
        }
        return { success: true, data } as ApiSuccess<T>;
      }),
    );
  }
}
