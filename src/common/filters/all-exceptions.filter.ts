import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiError } from '../http/api-response';

/**
 * Converts any thrown error into the standard `{ success: false, error }` envelope.
 * Unknown errors are logged with a stack trace and reported as 500 without leaking internals.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'Something went wrong';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      code = HttpStatus[status] ?? 'ERROR';
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>;
        message = (Array.isArray(b.message) ? b.message.join(', ') : (b.message as string)) ?? message;
        if (b.errors) details = b.errors;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${req.method} ${req.url} -> ${status}: ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const payload: ApiError = { success: false, error: { code, message, details } };
    res.status(status).json(payload);
  }
}
