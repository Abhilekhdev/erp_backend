/** Standard success envelope returned by the ResponseInterceptor. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

/** Standard error envelope returned by the AllExceptionsFilter. */
export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
