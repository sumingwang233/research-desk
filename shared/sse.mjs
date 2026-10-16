export async function* parseSSE(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', data = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, ''); buffer = buffer.slice(newline + 1);
        if (!line) { if (data.length) { yield data.join('\n'); data = []; } }
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (buffer.length > 1048576 || data.join('\n').length > 1048576) throw new Error('事件超出大小限制');
      if (done) { if (buffer.startsWith('data:')) data.push(buffer.slice(5).trim()); if (data.length) yield data.join('\n'); break; }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
