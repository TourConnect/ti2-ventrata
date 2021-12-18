const axios = require('axios');
const R = require('ramda');
const Promise = require('bluebird');
const assert = require('assert');
// const moment = require('moment');
const emptyOrNil = e => R.isNil(e) || R.isNil(e);
const stringify = require('./utils/stringify.js');
const wildcardMatch = require('./utils/wildcardMatch.js');

const { name: pluginNameParam } = require('./package.json');

const pluginName = pluginNameParam.replace(/@(.+)\//g, '');

const doMap = (obj, map) => {
  const retVal = {};
  Object.entries(map).forEach(([attribute, fn]) => {
    const newVal = fn(obj);
    if (newVal !== undefined) {
      retVal[attribute] = newVal;
    }
  });
  return retVal;
};

const productMapIn = {
  productId: R.path(['id']),
  productName: R.path(['title']),
  options: e => e.options.map(option => ({
    optionId: R.path(['id'], option),
    optionName: R.path(['title'], option),
  })),
};

const productMapOut = {
  id: R.path(['productId']),
  title: R.path(['productName']),
};

const getHeaders = ({ apiKey, acceptLanguage, octoEnv }) => ({
  Authorization: `Bearer ${apiKey}`,
  'Octo-Env': octoEnv,
  ...acceptLanguage ? { 'Accept-Language': acceptLanguage } : {},
  'Content-Type': 'application/json',
});

class Plugin {
  constructor(params) { // we get the env variables from here
    Object.entries(params).forEach(([attr, value]) => {
      const nuName = attr.replace(/_/g, '-').replace(`${pluginName}-`, '');
      this[nuName] = value;
    });
  }
  async searchProducts({
    token: {
      apiKey = this.apiKey,
      endpoint = this.endpoint,
      octoEnv = this.octoEnv,
      acceptLanguage = this.acceptLanguage,
    },
    payload,
  }) {
    let url = `${endpoint || this.endpoint}/products`;
    if (!emptyOrNil(payload)) {
      if (payload.productId) {
        url = `${url}/${payload.productId}`
      }
    }
    const headers = getHeaders({
      apiKey,
      endpoint,
      octoEnv,
    });
    let results = R.pathOr([], ['data'], await axios({
      method: 'get',
      url,
      headers,
    }));
    if (!Array.isArray(results)) results = [results];
    let products = results.map(e => doMap(e, productMapIn))
    // dynamic extra filtering
    if (!emptyOrNil(payload)) {
      const extraFilters = R.omit(['productId'], payload);
      if (Object.keys(extraFilters).length > 0) {
        products = products.filter(product => {
          return Object.entries(extraFilters).every(([key, value]) => {
            return wildcardMatch(value, product[key]);
          });
        });

      }
    }
    return ({ products });
  }
  async searchAvailability({
    token: {
      apiKey = this.apiKey,
      endpoint = this.endpoint,
      octoEnv = this.octoEnv,
      acceptLanguage = this.acceptLanguage,
    },
    payload: {
      productIds,
      optionIds,
      ocupancies,
    },
  }) {
    assert(productIds.length === optionIds.length, 'mismatched product/option combinations');
    assert(productIds.every(Boolean), 'some invalid productId(s)')
    assert(optionIds.every(Boolean), 'some invalid optionId(s)')
    const availability = productIds.map(productId => ({ productId}));
    let productsDetail = await Promise.map(R.uniq(productIds), productId => {
      const headers = getHeaders({
        apiKey,
        endpoint,
        octoEnv,
      });
      const url = `${endpoint || this.endpoint}/products/${productId}`;
      return axios({
        method: 'get',
        url,
        headers,
      });
    }, { concurrency: 3 }, // is this ok ?
    ).map(({ data }) => data);
    productsDetail = R.indexBy(R.prop('id'), productsDetail);
    console.log({ optionIds });
    // console.log(productsDetail.map(({ options }) => options));
    return {};
  }

}

module.exports = Plugin;
