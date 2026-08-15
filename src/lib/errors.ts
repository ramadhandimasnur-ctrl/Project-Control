/**
 * Application errors carry a machine-readable code plus an Indonesian message
 * that is safe and useful to show the user (charter rule 12: never "Error 500",
 * always something the user can act on).
 */

export type AppErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'MISSING_PRICE'
  | 'IMMUTABLE';

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  MISSING_PRICE: 422,
  IMMUTABLE: 409,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  /** Optional next step, e.g. "Tambahkan di Master Data → Daftar Harga." */
  readonly hint?: string;

  constructor(code: AppErrorCode, message: string, hint?: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    if (hint !== undefined) this.hint = hint;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export const unauthenticated = () =>
  new AppError('UNAUTHENTICATED', 'Sesi Anda sudah berakhir.', 'Silakan masuk kembali.');

export const forbidden = (message: string, hint?: string) =>
  new AppError('FORBIDDEN', message, hint);

export const notFound = (message: string, hint?: string) => new AppError('NOT_FOUND', message, hint);

export const validation = (message: string, hint?: string) =>
  new AppError('VALIDATION', message, hint);

export const conflict = (message: string, hint?: string) => new AppError('CONFLICT', message, hint);

/**
 * Turns any thrown value into a message pair suitable for a toast or an error
 * boundary. Unknown failures are never leaked verbatim to the user.
 */
export function toUserMessage(error: unknown): { message: string; hint?: string } {
  if (isAppError(error)) {
    return error.hint === undefined ? { message: error.message } : { message: error.message, hint: error.hint };
  }
  return {
    message: 'Terjadi kesalahan yang tidak terduga.',
    hint: 'Coba ulangi. Jika masih gagal, hubungi administrator.',
  };
}
