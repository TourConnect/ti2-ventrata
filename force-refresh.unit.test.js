/* globals describe, it, expect, jest */
jest.mock('./resolvers/product', () => ({
  translateProduct: jest.fn(async ({ rootValue }) => ({
    productId: rootValue.id,
    productName: rootValue.title,
  })),
}));

const Plugin = require('./index');

describe('searchProducts force refresh payload', () => {
  it.each([
    'forceRefresh', 'requestId', 'backgroundJob', 'cacheOnly',
    'fullSyncTrigger', 'admissionOverrideReason', 'fullSyncStartedAt',
    'fullSyncAdmissionToken', 'scheduledProductSyncEnabled', 'omitServiceCodes',
    'pickupPointsRequired', 'credentials',
  ])('keeps the full catalog when %s is string-valued metadata', async key => {
    const app = new Plugin({ endpoint: 'https://ventrata.example' });
    const axios = jest.fn(async () => ({
      data: [{ id: '1', title: 'City Highlights' }],
    }));

    const result = await app.searchProducts({
      axios,
      token: {
        endpoint: 'https://ventrata.example',
        apiKey: 'key',
        octoEnv: 'test',
        acceptLanguage: 'en',
      },
      payload: {
        [key]: 'internal-metadata',
      },
      typeDefsAndQueries: {},
    });

    expect(result.products).toEqual([
      { productId: '1', productName: 'City Highlights' },
    ]);
  });
});
