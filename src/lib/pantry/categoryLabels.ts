export function formatCategoryLabel(key: string | null): string {
  if (!key || key === 'other') return 'Other';
  return key
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
