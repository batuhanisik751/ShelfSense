export function isAuthBypassed(): boolean {
  return process.env.AUTH_BYPASS === '1' && process.env.NODE_ENV !== 'production';
}
