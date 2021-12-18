/* globals describe, beforeAll, it, expect */
const R = require('ramda');
const moment = require('moment');
const faker = require('faker');

const Plugin = require('./index');
const { name: pluginNameParam } = require('./package.json');

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
  describe('hotel booking process', () => {
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
    it('should be able to get future availability', async () => {
      const retVal = await app.searchAvailability({
        token,
        payload: {
          startDate: moment().add(6, 'M').format(dateFormat),
          endDate: moment().add(6, 'M').add(2, 'd').format(dateFormat),
          dateFormat,
          productIds: busProducts.map(({ productId }) => productId),
          optionIds: busProducts.map(({ options }) => 
            faker.random.arrayElement(options).optionId
          ),
          occupancies: [{ paxes: [{ age: 30 }, { age: 40 }] }],
        },
      });
      expect(retVal).toBeTruthy();
      ({ availability } = retVal);
      expect(availability.length).toBeGreaterThan(0);
    });
});
