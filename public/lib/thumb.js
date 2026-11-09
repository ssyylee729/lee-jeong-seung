// 화면에 썸네일을 그리기 전에 주소를 확인한다. info.json 이 잘못되거나 변조돼도 https 이미지가 아니면 쓰지 않는다.
export function safeImageUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}
