/* globals describe, beforeAll, it, expect */
const R = require('ramda');
const moment = require('moment');
const faker = require('faker');
const axios = require('axios');

const Plugin = require('./index');

const { typeDefs: productTypeDefs, query: productQuery } = require('./node_modules/ti2/controllers/graphql-schemas/product');
const { typeDefs: availTypeDefs, query: availQuery } = require('./node_modules/ti2/controllers/graphql-schemas/availability');
const { typeDefs: bookingTypeDefs, query: bookingQuery } = require('./node_modules/ti2/controllers/graphql-schemas/booking');
const { typeDefs: rateTypeDefs, query: rateQuery } = require('./node_modules/ti2/controllers/graphql-schemas/rate');
const { typeDefs: pickupTypeDefs, query: pickupQuery } = require('./node_modules/ti2/controllers/graphql-schemas/pickup-point');

const typeDefsAndQueries = {
  productTypeDefs,
  productQuery,
  availTypeDefs,
  availQuery,
  bookingTypeDefs,
  bookingQuery,
  rateTypeDefs,
  rateQuery,
  pickupQuery,
  pickupTypeDefs,
};

const app = new Plugin({
  jwtKey: process.env.ti2_ventrata_jwtKey,
  endpoint: process.env.ti2_ventrata_endpoint,
});

describe('search tests', () => {
  let products;
  let testProduct = {
    productName: 'Edinburgh Pub Crawl Tour',
  };
  const token = {
    apiKey: process.env.ti2_ventrata_apiKey,
    endpoint: process.env.ti2_ventrata_endpoint,
    octoEnv: process.env.ti2_ventrata_octoEnv,
    acceptLanguage: process.env.ti2_ventrata_acceptLanguage,
  };
  const dateFormat = 'DD/MM/YYYY';
  beforeAll(async () => {
    // nada
  });
  describe('utilities', () => {
    describe('validateToken', () => {
      it('valid token', async () => {
        const retVal = await app.validateToken({
          axios,
          token,
        });
        expect(retVal).toBeTruthy();
      });
      it('invalid token', async () => {
        const retVal = await app.validateToken({
          axios,
          token: { someRandom: 'thing' },
        });
        expect(retVal).toBeFalsy();
      });
    });
    describe('template tests', () => {
      let template;
      it('get the template', async () => {
        template = await app.tokenTemplate();
        const rules = Object.keys(template);
        expect(rules).toContain('apiKey');
        expect(rules).toContain('endpoint');
        expect(rules).toContain('octoEnv');
        expect(rules).toContain('acceptLanguage');
      });
      it('apiKey', () => {
        const apiKey = template.apiKey.regExp;
        expect(apiKey.test('something')).toBeFalsy();
        expect(apiKey.test('f5eb2e1f-4b8f-4b43-a858-4a12d77b8299')).toBeTruthy();
      });
      it('endpoint', () => {
        const endpoint = template.endpoint.regExp;
        expect(endpoint.test('something')).toBeFalsy();
        expect(endpoint.test('https://www.google.com')).toBeTruthy();
      });
      it('octoEnv', () => {
        const octoEnv = template.octoEnv.regExp;
        expect(octoEnv.test('something')).toBeFalsy();
        expect(octoEnv.test('live')).toBeTruthy();
      });
      it('acceptLanguage', () => {
        const acceptLanguage = template.acceptLanguage.regExp;
        expect(acceptLanguage.test('something')).toBeFalsy();
        expect(acceptLanguage.test('en')).toBeTruthy();
      });
    });
  });
  describe('booking process', () => {
    it('get for all products, a test product should exist', async () => {
      const retVal = await app.searchProducts({
        axios,
        token,
        typeDefsAndQueries,
      });
      expect(Array.isArray(retVal.products)).toBeTruthy();
      // console.log(retVal.products.filter(({ productName }) => productName === testProduct.productName));
      // console.log(retVal.products.map(p => p.productName))
      expect(retVal.products).toContainObject([{
        productName: testProduct.productName,
      }]);
      testProduct = {
        ...retVal.products.find(({ productName }) => productName === testProduct.productName),
      };
      expect(testProduct.productId).toBeTruthy();
    });
    it('should be able to get a single product', async () => {
      const retVal = await app.searchProducts({
        axios,
        token,
        payload: {
          productId: testProduct.productId,
        },
        typeDefsAndQueries,
      });
      expect(Array.isArray(retVal.products)).toBeTruthy();
      expect(retVal.products).toHaveLength(1);
    });
    let busProducts = [];
    it('should be able to get a product by name', async () => {
      const retVal = await app.searchProducts({
        axios,
        token,
        payload: {
          productName: '*bus*',
        },
        typeDefsAndQueries,
      });
      expect(Array.isArray(retVal.products)).toBeTruthy();
      expect(retVal.products.length).toBeGreaterThan(0);
      busProducts = retVal.products;
    });
    it('should be able to get an availability calendar', async () => {
      const retVal = await app.availabilityCalendar({
        axios,
        token,
        payload: {
          startDate: moment().add(6, 'M').format(dateFormat),
          endDate: moment().add(6, 'M').add(2, 'd').format(dateFormat),
          dateFormat,
          productIds: [
            '28ca088b-bc7b-4746-ab06-5971f1ed5a5e',
            '3465143f-4902-447a-9c1e-8e5598666663',
          ],
          optionIds: ['DEFAULT', 'dbe73645-2dd9-4cde-ade0-4faa95668d01'],
          units: [
            [{ unitId: 'unit_c1709f42-297e-4f7e-bd6b-3e77d4622d8a', quantity: 2 }],
            [{ unitId: 'unit_d49f8d25-5b37-4365-b67d-daa0594d021e', quantity: 2 }],
          ],
        },
        typeDefsAndQueries,
      });
      expect(retVal).toBeTruthy();
      const { availability } = retVal;
      expect(availability).toHaveLength(2);
      expect(availability[0].length).toBeGreaterThan(0);
    });

    let availabilityKey;
    it('should be able to get availability', async () => {
      const retVal = await app.searchAvailability({
        axios,
        token,
        typeDefsAndQueries,
        payload: {
          startDate: moment().add(6, 'M').format(dateFormat),
          endDate: moment().add(6, 'M').add(2, 'd').format(dateFormat),
          dateFormat,
          productIds: [
            '20ef1799-7020-484b-9fb5-905ec5bb5444',
            '3465143f-4902-447a-9c1e-8e5598666663',
          ],
          optionIds: ['DEFAULT', 'dbe73645-2dd9-4cde-ade0-4faa95668d01'],
          units: [
            [{ unitId: 'unit_3e987c7b-b87e-47bf-8638-148cdaf700af', quantity: 2 }],
            [{ unitId: 'unit_d49f8d25-5b37-4365-b67d-daa0594d021e', quantity: 2 }],
          ],
        },
      });
      expect(retVal).toBeTruthy();
      const { availability } = retVal;
      expect(availability).toHaveLength(2);
      expect(availability[0].length).toBeGreaterThan(0);
      availabilityKey = R.path([0, 0, 'key'], availability);
      expect(availabilityKey).toBeTruthy();
    });
    let booking;
    const reference = faker.datatype.uuid();
    it('should be able to create a booking', async () => {
      const fullName = faker.name.findName().split(' ');
      const retVal = await app.createBooking({
        axios,
        token,
        typeDefsAndQueries,
        payload: {
          availabilityKey,
          notes: faker.lorem.paragraph(),
          settlementMethod: 'DEFERRED',
          holder: {
            name: fullName[0],
            surname: fullName[1],
            phone: faker.phone.phoneNumber(),
            emailAddress: `salvador+tests_${faker.lorem.slug()}@tourconnect.com`,
            country: faker.address.countryCode(),
            locales: ['en-US', 'en', 'es'],
          },
          reference,
        },
      });
      expect(retVal.booking).toBeTruthy();
      ({ booking } = retVal);
      expect(booking).toBeTruthy();
      expect(R.path(['id'], booking)).toBeTruthy();
      expect(R.path(['supplierBookingId'], booking)).toBeTruthy();
      expect(R.path(['cancellable'], booking)).toBeTruthy();
      // console.log({ booking });
    });
    it('should be able to cancel the booking', async () => {
      const retVal = await app.cancelBooking({
        axios,
        token,
        typeDefsAndQueries,
        payload: {
          bookingId: booking.id,
          reason: faker.lorem.paragraph(),
        },
      });
      const { cancellation } = retVal;
      expect(cancellation).toBeTruthy();
      expect(cancellation).toBeTruthy();
      expect(R.path(['id'], cancellation)).toBeTruthy();
      expect(R.path(['cancellable'], cancellation)).toBeFalsy();
    });
    let bookings = [];
    it('it should be able to search bookings by id', async () => {
      const retVal = await app.searchBooking({
        axios,
        token,
        typeDefsAndQueries,
        payload: {
          bookingId: booking.id,
        },
      });
      expect(Array.isArray(retVal.bookings)).toBeTruthy();
      ({ bookings } = retVal);
      expect(R.path([0, 'id'], bookings)).toBeTruthy();
    });
    // this is not working for ventrata anymore, but we don't need this anyway right now
    it.skip('it should be able to search bookings by reference', async () => {
      const retVal = await app.searchBooking({
        axios,
        token,
        typeDefsAndQueries,
        payload: {
          bookingId: reference,
        },
      });
      expect(Array.isArray(retVal.bookings)).toBeTruthy();
      ({ bookings } = retVal);
      expect(R.path([0, 'id'], bookings)).toBeTruthy();
    });
    it('it should be able to search bookings by supplierBookingId', async () => {
      const retVal = await app.searchBooking({
        axios,
        token,
        typeDefsAndQueries,
        payload: {
          bookingId: booking.supplierBookingId,
        },
      });
      expect(Array.isArray(retVal.bookings)).toBeTruthy();
      ({ bookings } = retVal);
      expect(R.path([0, 'id'], bookings)).toBeTruthy();
    });
    it('it should be able to search bookings by travelDate', async () => {
      const retVal = await app.searchBooking({
        axios,
        token,
        typeDefsAndQueries,
        payload: {
          travelDateStart: moment().add(6, 'M').format(dateFormat),
          travelDateEnd: moment().add(6, 'M').add(2, 'd').format(dateFormat),
          dateFormat,
        },
      });
      expect(Array.isArray(retVal.bookings)).toBeTruthy();
      ({ bookings } = retVal);
      expect(R.path([0, 'id'], bookings)).toBeTruthy();
    });
    it('should be able to create a booking for a referrer', async () => {
      const fullName = faker.name.findName().split(' ');
      const retVal = await app.createBooking({
        axios,
        token,
        typeDefsAndQueries,
        payload: {
          availabilityKey,
          notes: faker.lorem.paragraph(),
          holder: {
            name: fullName[0],
            surname: fullName[1],
            phone: faker.phone.phoneNumber(),
            emailAddress: `salvador+tests_${faker.lorem.slug()}@tourconnect.com`,
            country: faker.address.countryCode(),
            locales: ['en-US', 'en', 'es'],
          },
          reference,
          referrer: 'referrerforapitest',
          settlementMethod: 'DEFERRED',
        },
      });
      expect(retVal.booking).toBeTruthy();
      ({ booking } = retVal);
      expect(booking).toBeTruthy();
      expect(R.path(['id'], booking)).toBeTruthy();
      expect(R.path(['supplierBookingId'], booking)).toBeTruthy();
      expect(R.path(['cancellable'], booking)).toBeTruthy();
    });
    it('should be able to get a list of pickuppoints', async () => {
      const retVal = await app.getPickupPoints({
        axios,
        token,
        typeDefsAndQueries,
      });
      expect(Array.isArray(retVal.pickupPoints)).toBeTruthy();
      expect(R.path(['pickupPoints', 0, 'id'], retVal)).toBeTruthy();
    });
  });
});
