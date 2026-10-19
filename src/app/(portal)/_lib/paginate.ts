// The portal's leads list, one page at a time. Pure: it slices rows the page
// already loaded, so it can show nothing the server did not already send.

export const PORTAL_PAGE_SIZE = 25;

export type Page<T> = {
  /** 1-based, clamped into 1..pageCount. */
  page: number;
  pageCount: number;
  /** 1-based positions of the first and last row shown; 0 and 0 when empty. */
  first: number;
  last: number;
  total: number;
  items: T[];
};

export function paginate<T>(rows: readonly T[], page: number, size = PORTAL_PAGE_SIZE): Page<T> {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * size;
  const items = rows.slice(start, start + size);
  return {
    page: current,
    pageCount,
    first: items.length === 0 ? 0 : start + 1,
    last: start + items.length,
    total,
    items,
  };
}
