export function tabIndexForKey(key: string, index: number, count: number) {
  switch (key) {
    case 'Home': return 0;
    case 'End': return count - 1;
    case 'ArrowRight': return (index + 1) % count;
    case 'ArrowLeft': return (index + count - 1) % count;
    default: return undefined;
  }
}
