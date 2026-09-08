export async function send(type, payload = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...payload });
  if (!result?.ok) throw new Error(result?.error || '扩展后台没有返回结果，请重新打开扩展页面。');
  return result.data;
}
