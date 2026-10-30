const OCTO_PAGE_LIMIT = 100;

const headerValue = (headers, name) => {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') {
    const fromGetter = headers.get(name);
    if (fromGetter != null && fromGetter !== '') return fromGetter;
  }
  const lowerName = name.toLowerCase();
  if (headers[lowerName] != null && headers[lowerName] !== '') return headers[lowerName];
  if (headers[name] != null && headers[name] !== '') return headers[name];
  return undefined;
};

const nextPageCursor = headers => {
  const value = headerValue(headers, 'octo-next-page');
  if (Array.isArray(value)) return value.find(Boolean) || '';
  return value == null ? '' : String(value);
};

// Cursor pagination for OCTO list endpoints. The first request omits page.
// Each later request sends the previous Octo-Next-Page value unchanged.
const getOctoList = async ({ axios, url, headers }) => {
  const records = [];
  let page;
  const seenCursors = new Set();
  // Each cursor comes from the previous response, so pages must be read in order.
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const response = await axios({
      method: 'get',
      url,
      headers,
      params: {
        limit: OCTO_PAGE_LIMIT,
        ...(page ? { page } : {}),
      },
    });
    const data = response && response.data;
    if (!Array.isArray(data)) {
      throw new Error('Ventrata list response was not an array');
    }
    records.push(...data);
    const cursor = nextPageCursor(response && response.headers);
    if (!cursor) return records;
    if (seenCursors.has(cursor)) {
      throw new Error('Ventrata pagination cursor repeated');
    }
    seenCursors.add(cursor);
    page = cursor;
  }
};

module.exports = {
  OCTO_PAGE_LIMIT,
  getOctoList,
};
