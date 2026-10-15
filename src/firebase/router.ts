import type { Row } from '../../shared/query';
export type ClientRequest = { user: Row; query: Record<string, string>; params: Record<string, string>; body: any; sessionHash: string };
type ClientResponse = { json(value: any): void; status(code: number): ClientResponse };
type Handler = (req: ClientRequest, res: ClientResponse) => unknown;
export class ClientRouter {
  private routes: { method: string; path: string; handler: Handler }[] = [];
  get(path: string, handler: Handler) { this.routes.push({ method: 'GET', path, handler }); }
  post(path: string, handler: Handler) { this.routes.push({ method: 'POST', path, handler }); }
  put(path: string, handler: Handler) { this.routes.push({ method: 'PUT', path, handler }); }
  async invoke(path: string, method: string, user: Row, body?: unknown) {
    const url = new URL('/api' + path, 'https://cadence.local');
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const expected = route.path.split('/'), actual = url.pathname.split('/');
      if (expected.length !== actual.length || expected.some((s, i) => !s.startsWith(':') && s !== actual[i])) continue;
      let result: any;
      const res: ClientResponse = { json(value) { result = value; }, status() { return res; } };
      await route.handler({ user, query: Object.fromEntries(url.searchParams), params: Object.fromEntries(expected.flatMap((s, i) => s.startsWith(':') ? [[s.slice(1), decodeURIComponent(actual[i])]] : [])), body, sessionHash: '' }, res);
      return result;
    }
    throw Error('This action is unavailable. Refresh the page and try again.');
  }
}
export function fail(_status: number, message: string): never { throw Error(message); }
export function publicUser(user: Row) {
  const keys = ['id', 'email', 'name', 'employee_code', 'access', 'role_id', 'role_name', 'active', 'joining_date', 'timezone', 'deadline', 'notifications', 'email_notifications', 'created_at'];
  return { ...Object.fromEntries(keys.map(k => [k, user[k]])), workdays: typeof user.workdays === 'string' ? JSON.parse(user.workdays) : user.workdays };
}
