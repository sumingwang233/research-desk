let session;
export async function initSession() {
  session ||= await window.desk.session();
  return session;
}
export function getSession() { return session; }
export async function api(route, data, signal) {
  const response = await fetch(`${session.origin}${route}`, {
    method: data ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    ...(data ? { body: JSON.stringify(data) } : {}),
    signal
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '操作失败');
  return result;
}
