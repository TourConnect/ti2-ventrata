/* globals describe, beforeAll, it, expect */
const R = require('ramda');
const moment = require('moment');
const faker = require('faker');

const Plugin = require('./index');
const { name: pluginNameParam } = require('./package.json');
const fixtureUnits = require('./__fixtures__/units.js');

const pluginName = pluginNameParam.replace(/@(.+)\//g, '');

const app = new Plugin(R.pickBy(
  (_val, key) => key.replace(/_/g, '-').substring(0, pluginName.length) === pluginName,
  process.env,
));

const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];

describe('search tests', () => {
  let products;
  let testProduct = {
    productName: 'Pub Crawl Tour',
  }
  const token = {
    apiKey: app.apiKey,
    endpoint: app.endpoint,
    octoEnv: app.octoEnv,
    acceptLanguage: app.acceptLanguage,
  };
  const dateFormat = 'DD/MM/YYYY';
  beforeAll(async () => {
    // nada
  });
  describe('utilities', () => {
    describe('pickUnit', () => {
      it('adult', () => {
        const result = Plugin.pickUnit(fixtureUnits, [{ age: 40 }]);
        expect(result.length).toBe(1);
        expect(result[0]).toContainObject([{ id: 'adult' }]);
      });
      it('child', () => {
        const result = Plugin.pickUnit(fixtureUnits, [{ age: 10 }]);
        expect(result.length).toBe(1);
        expect(result[0]).toContainObject([{ id: 'child' }]);
      });
      it('senior', () => {
        const result = Plugin.pickUnit(fixtureUnits, [{ age: 70 }]);
        expect(result.length).toBe(1);
        expect(result[0]).toContainObject([{ id: 'senior' }]);
      });
      it('family', () => {
        const result = Plugin.pickUnit(fixtureUnits, [
          { age: 70 }, { age: 32 }, { age: 32 }, { age: 14 },
        ]);
        expect(result.length).toBe(1);
        expect(result[0]).toContainObject([{ id: 'family' }]);
      });
      it.todo('family + one');
    });
  });
  describe('booking process', () => {
    it('get for all products, a test product should exist', async () => {
      const retVal = await app.searchProducts({
        token,
      });
      expect(Array.isArray(retVal.products)).toBeTruthy();
      // console.log(retVal.products.filter(({ productName }) => productName === testProduct.productName));
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
        token,
        payload: {
          productId: testProduct.productId,
        }
      });
      expect(Array.isArray(retVal.products)).toBeTruthy();
      expect(retVal.products).toHaveLength(1);
    });
    let busProducts = [];
    it('should be able to get a product by name', async () => {
      const retVal = await app.searchProducts({
        token,
        payload: {
          productName: '*bus*',
        }
      });
      expect(Array.isArray(retVal.products)).toBeTruthy();
      expect(retVal.products.length).toBeGreaterThan(0);
      busProducts = retVal.products;
    });
    it('should be able to get quotes', async () => {
      const retVal = await app.searchQuote({
        token,
        payload: {
          startDate: moment().add(6, 'M').format(dateFormat),
          endDate: moment().add(6, 'M').add(2, 'd').format(dateFormat),
          dateFormat,
          productIds: busProducts.map(({ productId }) => productId),
          optionIds: busProducts.map(({ options }) => 
            faker.random.arrayElement(options).optionId
          ),
          occupancies: [
            [{ age: 30 }, { age: 40 }],
            [{ age: 30 }, { age: 40 }],
          ],
        },
      });
      expect(retVal).toBeTruthy();
      ({ quote } = retVal);
      expect(quote.length).toBeGreaterThan(0);
      expect(quote[0]).toContainObject([{
        rateId: 'adult',
        pricing: expect.toContainObject([{
          currency: 'USD',
        }]),
      }]);
    });
    let availabilityKey;
    it('should be able to get availability', async () => {
      const retVal = await app.searchAvailability({
        token,
        payload: {
          startDate: moment().add(6, 'M').format(dateFormat),
          endDate: moment().add(6, 'M').add(2, 'd').format(dateFormat),
          dateFormat,
          productIds: [
            '28ca088b-bc7b-4746-ab06-5971f1ed5a5e',
            '5d981651-e204-4549-bfbe-691043dd2515'
          ],
          optionIds: ['DEFAULT', 'DEFAULT'],
          occupancies: [
            [{ age: 30 }, { age: 40 }],
            [{ age: 30 }, { age: 40 }],
          ],
        },
      });
      expect(retVal).toBeTruthy();
      ({ availability } = retVal);
      expect(availability).toHaveLength(2);
      expect(availability[0].length).toBeGreaterThan(0)
      availabilityKey = R.path([0, 0, 'key'], availability);
      expect(availabilityKey).toBeTruthy();
    });
    let booking;
    const reference = faker.datatype.uuid();
    it('should be able to create a booking', async () => {
      const fullName = faker.name.findName().split(' ');
      const retVal = await app.createBooking({
        token,
        payload: {
          availabilityKey,
          notes: faker.lorem.paragraph(),
          holder: {
            name: fullName[0],
            surname: fullName[1],
            phoneNumber: faker.phone.phoneNumber(),
            emailAddress: `salvador+tests_${faker.lorem.slug()}@tourconnect.com`,
            country: faker.address.countryCode(),
            locales:  ['en-US', 'en', 'es'],
          },
          reference,
        },
      });
      expect(retVal.booking).toBeTruthy();
      ({ booking } = retVal);
      expect(booking).toBeTruthy();
      expect(R.path(['id'], booking)).toBeTruthy()
      expect(R.path(['supplierId'], booking)).toBeTruthy()
      expect(R.path(['cancellable'], booking)).toBeTruthy()
      // console.log({ booking });
    });
    it('should be able to cancel the booking', async () => {
      const retVal = await app.cancelBooking({
        token,
        payload: {
          bookingId: booking.id,
          reason: faker.lorem.paragraph(),
        }
      });
      expect(retVal.booking).toBeTruthy();
      ({ booking } = retVal);
      expect(booking).toBeTruthy();
      expect(R.path(['id'], booking)).toBeTruthy()
      expect(R.path(['cancellable'], booking)).toBeFalsy()
    });
    let bookings = [];
    it('it should be able to search bookings by id', async () => {
      const retVal = await app.searchBooking({
        token,
        payload: {
          bookingId: booking.id,
        }
      });
      expect(Array.isArray(retVal.bookings)).toBeTruthy();
      ({ bookings } = retVal);
      expect(R.path([0, 'id'], bookings)).toBeTruthy()
    });
    it('it should be able to search bookings by reference', async () => {
      const retVal = await app.searchBooking({
        token,
        payload: {
          bookingId: reference,
        }
      });
      expect(Array.isArray(retVal.bookings)).toBeTruthy();
      ({ bookings } = retVal);
      expect(R.path([0, 'id'], bookings)).toBeTruthy()
    });
    it('it should be able to search bookings by supplierId', async () => {
      const retVal = await app.searchBooking({
        token,
        payload: {
          bookingId: booking.supplierId,
        }
      });
      expect(Array.isArray(retVal.bookings)).toBeTruthy();
      ({ bookings } = retVal);
      expect(R.path([0, 'id'], bookings)).toBeTruthy()
    });
    it('it should be able to search bookings by travelDate', async () => {
      const retVal = await app.searchBooking({
        token,
        payload: {
          travelDateStart: moment().add(6, 'M').format(dateFormat),
          travelDateEnd: moment().add(6, 'M').add(2, 'd').format(dateFormat),
          dateFormat,
        }
      });
      expect(Array.isArray(retVal.bookings)).toBeTruthy();
      ({ bookings } = retVal);
      expect(R.path([0, 'id'], bookings)).toBeTruthy()
    });
 });
});
