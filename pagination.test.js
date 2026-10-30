/* globals describe, it, expect, jest */
const Plugin = require('./index');
const { typeDefs: productTypeDefs, query: productQuery } = require('./node_modules/ti2/controllers/graphql-schemas/product');
const { typeDefs: bookingTypeDefs, query: bookingQuery } = require('./node_modules/ti2/controllers/graphql-schemas/booking');
const { typeDefs: pickupTypeDefs, query: pickupQuery } = require('./node_modules/ti2/controllers/graphql-schemas/pickup-point');

const plugin = new Plugin({ endpoint: 'https://api.ventrata.com/octo' });
const token = {
  apiKey: 'f5eb2e1f-4b8f-4b43-a858-4a12d77b8299',
  endpoint: 'https://api.ventrata.com/octo',
  octoEnv: 'test',
  acceptLanguage: 'en',
};

const productPage = (products, next) => ({
  data: products,
  headers: next ? { 'octo-next-page': next } : {},
});

const ventrataProduct = id => ({
  id,
  internalName: `Product ${id}`,
  options: [],
});

const ventrataBooking = id => ({
  id,
  status: 'confirmed',
  unitItems: [],
  option: {},
  contact: { fullName: 'Test User' },
});

describe('OCTO list pagination', () => {
  it('loads every product page before filtering', async () => {
    const axios = jest.fn()
      .mockResolvedValueOnce(productPage([ventrataProduct('p1')], 'cursor-2'))
      .mockResolvedValueOnce(productPage([ventrataProduct('kept')]));
    const { products } = await plugin.searchProducts({
      axios,
      token,
      payload: { productName: '*kept*' },
      typeDefsAndQueries: { productTypeDefs, productQuery },
    });
    expect(products.map(product => product.productId)).toEqual(['kept']);
    expect(axios.mock.calls[0][0].params).toEqual({ limit: 100 });
    expect(axios.mock.calls[0][0].url).toBe('https://api.ventrata.com/octo/products');
    expect(axios.mock.calls[1][0].params).toEqual({ limit: 100, page: 'cursor-2' });
  });

  it('does not paginate a single product lookup', async () => {
    const axios = jest.fn().mockResolvedValue({
      data: ventrataProduct('p1'),
      headers: { 'octo-next-page': 'ignored' },
    });
    const { products } = await plugin.searchProducts({
      axios,
      token,
      payload: { productId: 'p1' },
      typeDefsAndQueries: { productTypeDefs, productQuery },
    });
    expect(products).toHaveLength(1);
    expect(axios.mock.calls[0][0].url).toBe('https://api.ventrata.com/octo/products/p1');
    expect(axios.mock.calls[0][0].params).toBeUndefined();
  });

  it('concatenates booking list pages for a reference search', async () => {
    const axios = jest.fn()
      .mockResolvedValueOnce(productPage([ventrataBooking('b1')], 'next-booking'))
      .mockResolvedValueOnce(productPage([ventrataBooking('b2')]));
    const { bookings } = await plugin.searchBooking({
      axios,
      token,
      payload: { reference: 'REF-1' },
      typeDefsAndQueries: { bookingTypeDefs, bookingQuery },
    });
    expect(bookings.map(booking => booking.id)).toEqual(['b1', 'b2']);
    expect(axios.mock.calls[0][0].url).toBe('https://api.ventrata.com/octo/bookings?resellerReference=REF-1');
    expect(axios.mock.calls[1][0].params.page).toBe('next-booking');
  });

  it('paginates reference lookups when searching by booking id, and leaves the id lookup unpaged', async () => {
    const axios = jest.fn()
      .mockResolvedValueOnce({ data: ventrataBooking('direct') })
      .mockResolvedValueOnce(productPage([ventrataBooking('reseller')]))
      .mockResolvedValueOnce(productPage([ventrataBooking('supplier')]));
    const { bookings } = await plugin.searchBooking({
      axios,
      token,
      payload: { bookingId: 'direct' },
      typeDefsAndQueries: { bookingTypeDefs, bookingQuery },
    });
    expect(bookings.map(booking => booking.id)).toEqual(['direct', 'reseller', 'supplier']);
    expect(axios.mock.calls[0][0].url).toBe('https://api.ventrata.com/octo/bookings/direct');
    expect(axios.mock.calls[0][0].params).toBeUndefined();
    expect(axios.mock.calls[1][0].params).toEqual({ limit: 100 });
    expect(axios.mock.calls[2][0].url).toContain('supplierReference=direct');
  });

  it('fails a booking id search when a later list page fails', async () => {
    const axios = jest.fn()
      .mockResolvedValueOnce({ data: ventrataBooking('direct') })
      .mockResolvedValueOnce(productPage([ventrataBooking('reseller')], 'next-booking'))
      .mockResolvedValueOnce(productPage([ventrataBooking('supplier')]))
      .mockRejectedValueOnce(new Error('page failed'));
    await expect(plugin.searchBooking({
      axios,
      token,
      payload: { bookingId: 'direct' },
      typeDefsAndQueries: { bookingTypeDefs, bookingQuery },
    })).rejects.toThrow('page failed');
  });

  it('fails product search when a later page is not a list', async () => {
    const axios = jest.fn()
      .mockResolvedValueOnce(productPage([ventrataProduct('p1')], 'cursor-2'))
      .mockResolvedValueOnce({ data: { error: 'malformed' }, headers: {} });
    await expect(plugin.searchProducts({
      axios,
      token,
      typeDefsAndQueries: { productTypeDefs, productQuery },
    })).rejects.toThrow('Ventrata list response was not an array');
  });

  it('collects pickup points from later product pages', async () => {
    const axios = jest.fn()
      .mockResolvedValueOnce(productPage([{
        options: [{ pickupPoints: [{ id: 'stop-1', name: 'First' }] }],
      }], 'more-products'))
      .mockResolvedValueOnce(productPage([{
        options: [{ pickupPoints: [{ id: 'stop-2', name: 'Second' }] }],
      }]));
    const { pickupPoints } = await plugin.getPickupPoints({
      axios,
      token,
      typeDefsAndQueries: { pickupTypeDefs, pickupQuery },
    });
    expect(pickupPoints.map(point => point.id)).toEqual(['stop-1', 'stop-2']);
  });

  it('collects custom fields from later product pages', async () => {
    const axios = jest.fn()
      .mockResolvedValueOnce(productPage([{
        options: [{ questions: [{ id: 'q1', label: 'First', inputType: 'text' }] }],
      }], 'more-products'))
      .mockResolvedValueOnce(productPage([{
        options: [{ questions: [{ id: 'q2', label: 'Second', inputType: 'text' }] }],
      }]));
    const { customFields } = await plugin.getCreateBookingFields({
      axios,
      token,
      query: {},
    });
    expect(customFields.map(field => field.id)).toEqual(['q1', 'q2']);
  });
});
