/** Typed application errors so the UI can react precisely instead of guessing from strings. */
export type AppErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'CAPSULE_LOCKED'
  | 'SPACE_FULL'
  | 'INVITE_INVALID'
  | 'INVITE_EXPIRED'
  | 'INVITE_USED'
  | 'UPLOAD_REJECTED'
  | 'STORAGE_LIMIT'
  | 'NETWORK'
  | 'UNKNOWN';

export class AppError extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AppError';
    this.code = code;
  }
}

export class CapsuleLockedError extends AppError {
  readonly opensAt: string;

  constructor(opensAt: string) {
    super('CAPSULE_LOCKED', '这颗时间胶囊还没有到开启的时刻。');
    this.name = 'CapsuleLockedError';
    this.opensAt = opensAt;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function errorMessage(error: unknown, fallback = '发生了意外错误，请稍后重试。'): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export function errorCode(error: unknown): AppErrorCode {
  return error instanceof AppError ? error.code : 'UNKNOWN';
}
