/* globals describe, it, expect, jest */
const { getOctoList, OCTO_PAGE_LIMIT } = require('./octoPagination');

const page = ({ data, next }) => ({
  data,
  headers: next ? { 'octo-next-page': next } : {},
});

describe('getOctoList', () => {
  const url = 'https://api.ventrata.com/octo/products';
  const headers = { Authorization: 'Bearer test-key' };

  it('requests the first page without page and stops when Octo-Next-Page is absent', async () => {
    const axios = jest.fn().mockResolvedValue(page({ data: [{ id: 'a' }] }));
    const records = await getOctoList({ axios, url, headers });
    expect(records).toEqual([{ id: 'a' }]);
    expect(axios).toHaveBeenCalledTimes(1);
    expect(axios.mock.calls[0][0]).toEqual({
      method: 'get',
      url,
      headers,
      params: { limit: OCTO_PAGE_LIMIT },
    });
  });

  it('follows Octo-Next-Page and keeps the same url, filters, and headers', async () => {
    const cursor = 'opaque cursor/with spaces?&=';
    const axios = jest.fn()
      .mockResolvedValueOnce(page({ data: [{ id: 'a' }], next: cursor }))
      .mockResolvedValueOnce(page({ data: [{ id: 'b' }] }));
    const records = await getOctoList({
      axios,
      url: 'https://api.ventrata.com/octo/bookings?resellerReference=ABC',
      headers,
    });
    expect(records).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(axios.mock.calls[1][0]).toEqual({
      method: 'get',
      url: 'https://api.ventrata.com/octo/bookings?resellerReference=ABC',
      headers,
      params: { limit: OCTO_PAGE_LIMIT, page: cursor },
    });
  });

  it('reads the cursor from an AxiosHeaders getter', async () => {
    const axios = jest.fn()
      .mockResolvedValueOnce({
        data: [{ id: 'a' }],
        headers: { get: name => (name === 'octo-next-page' ? 'cursor-2' : undefined) },
      })
      .mockResolvedValueOnce(page({ data: [{ id: 'b' }] }));
    const records = await getOctoList({ axios, url, headers });
    expect(records).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(axios.mock.calls[1][0].params.page).toBe('cursor-2');
  });

  it('rejects a non-array page instead of treating earlier pages as complete', async () => {
    const axios = jest.fn()
      .mockResolvedValueOnce(page({ data: [{ id: 'a' }], next: 'cursor-2' }))
      .mockResolvedValueOnce({
        data: { id: 'not-a-list' },
        headers: {},
      });
    await expect(getOctoList({ axios, url, headers })).rejects.toThrow('Ventrata list response was not an array');
    expect(axios).toHaveBeenCalledTimes(2);
  });

  it('rejects a repeated cursor instead of looping', async () => {
    const axios = jest.fn().mockResolvedValue(page({ data: [{ id: 'a' }], next: 'same' }));
    await expect(getOctoList({ axios, url, headers })).rejects.toThrow('Ventrata pagination cursor repeated');
    expect(axios).toHaveBeenCalledTimes(2);
  });
});
