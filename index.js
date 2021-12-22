const axios = require('axios');
const R = require('ramda');
const Promise = require('bluebird');
const assert = require('assert');
const moment = require('moment');
const jwt = require('jsonwebtoken');
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

const rateMapOut = {
  rateId: R.path(['id']),
  rateName: R.path(['internalName']),
  pricing: R.path(['pricingFrom']),
};

const availabilityMap = {
  dateTimeStart: R.path(['localDateTimeStart']),
  dateTimeEnd: R.path(['localDateTimeEnd']),
  allDay: R.path(['allDay']),
  pricing: R.path(['pricing']),
  offer: avail => Boolean(avail.offerCode) ? doMap(avail, {
    offerId: R.path(['offerCode']),
    title: R.pathOr(undefined, ['offerTitle']),
    description: R.pathOr(undefined, ['offer', 'description']),
  }) : undefined,
  meetingPoint: avail => Boolean(avail.meetingPoint) ? doMap(avail, {
    description: R.pathOr(undefined, ['meetingPoint']),
    dateTime: R.pathOr(undefined, ['meetingLocalDateTime']),
    coordinates: () => (Boolean(avail.meetingPointLatitude)
      && Boolean(avail.meetingPointLongitude)) ? doMap(avail, {
        lat: R.path(['meetingPointLatitude']),
        long: R.path(['meetingPointLongitude']),
      }) : undefined,
  }) : undefined,
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
  async searchQuote({
    token: {
      apiKey = this.apiKey,
      endpoint = this.endpoint,
      octoEnv = this.octoEnv,
      acceptLanguage = this.acceptLanguage,
    },
    payload: {
      productIds,
      optionIds,
      occupancies,
    },
  }) {
    assert(occupancies.length > 0, 'there should be at least one occupancy');
    assert(productIds.length === optionIds.length, 'mismatched product/option combinations');
    assert(productIds.length === occupancies.length, 'mismatched product/occupancies combinations');
    assert(productIds.every(Boolean), 'some invalid productId(s)')
    assert(optionIds.every(Boolean), 'some invalid optionId(s)')
    assert(occupancies.every(Boolean), 'some invalid occupacies(s)')
    const quote = occupancies.map(() => productIds.map(productId => ({ productId })));
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
    // console.log({ optionIds });
    productIds.forEach((productId, productIdIx) => {
      const optionDetail = productsDetail[productId]
        .options.filter(({ id }) => id === optionIds[productIdIx])[0];
      quote[productIdIx] = pickUnit(optionDetail.units, occupancies[productIdIx]).map(e => doMap(e, rateMapOut));
    });
    return { quote };
  }

  async searchAvailability({
    token: {
      apiKey = this.apiKey,
      endpoint = this.endpoint,
      octoEnv = this.octoEnv,
      acceptLanguage = this.acceptLanguage,
    },
    token,
    payload: {
      productIds,
      optionIds,
      occupancies,
      startDate,
      endDate,
      dateFormat,
    },
  }) {
    assert(this.jwtKey, 'JWT secret should be set');
    assert(occupancies.length > 0, 'there should be at least one occupancy');
    assert(productIds.length === optionIds.length,
      'mismatched productIds/options length')
    assert(optionIds.length === occupancies.length,
      'mismatched options/occupancies length');
    assert(productIds.every(Boolean), 'some invalid productId(s)')
    assert(optionIds.every(Boolean), 'some invalid optionId(s)')
    assert(occupancies.every(Boolean), 'some invalid occupacies(s)')
    const localDateStart = moment(startDate, dateFormat).format('YYYY-MM-DD')
    const localDateEnd = moment(startDate, dateFormat).format('YYYY-MM-DD')
    // obtain the rates
    const { quote } = await this.searchQuote({
      token,
      payload: {
        productIds,
        optionIds,
        occupancies,
      },
    });
    const rates = quote.map(q => q.map(({ rateId }) => rateId));
    const headers = getHeaders({
      apiKey,
      endpoint,
      octoEnv,
    });
    const url = `${endpoint || this.endpoint}/availability`;
    let availability = (
    await Promise.map(rates, async (rate, rateIx) => {
      const qtys = R.countBy(x => x)(rate);
      const data = {
        productId: productIds[rateIx],
        optionId: optionIds[rateIx],
        localDateStart,
        localDateEnd,
        units: Object.entries(qtys).map(([id, quantity]) => ({
          id, quantity,
        })),
      };
      return axios({
        method: 'post',
        url,
        data,
        headers,
      });
    }, { concurrency: 3 }) // is this ok ?
    ).map(({ data }) => data);
    availability = availability.map(
      (avails, availsIx) => avails.map(
        avail => avail.available ? ({
          key: jwt.sign(({
            productId: productIds[availsIx],
            optionId: optionIds[availsIx],
            availabilityId: avail.id,
            unitItems: rates[availsIx].map(rate => ({ unitId: rate })),
          }), this.jwtKey),
          ...doMap(avail, availabilityMap),
          available: true
        }) : ({
          available: false
        })
      ));
    return { availability };
  }

  async createBooking({
    token: {
      apiKey = this.apiKey,
      endpoint = this.endpoint,
      octoEnv = this.octoEnv,
      acceptLanguage = this.acceptLanguage,
    },
    token,
    payload: {
      availabilityKey,
      notes,
    },
  }) {
    assert(availabilityKey);
    const headers = getHeaders({
      apiKey,
      endpoint,
      octoEnv,
    });
    const url = `${endpoint || this.endpoint}/bookings`;
    const data = await jwt.verify(availabilityKey, this.jwtKey);
    const booking = R.path(['data'], await axios({
      method: 'post',
      url,
      data: { ...data, notes },
      headers,
    }));
    return({ booking });
  }
}

const pickUnit = (units, paxs) => {
  const evalOne = (unit, pax) => {
    if (pax.age < R.path(['restrictions', 'minAge'], unit))
      return false;
    if (pax.age > R.path(['restrictions', 'maxAge'], unit))
      return false;
    return true;
  };
  if (paxs.length > 1) { // find group units
    const group = units.filter(({ restrictions }) => Boolean(restrictions)).find(unit => {
      if (
        R.path(['restrictions', 'paxCount'], unit) == paxs.length
        && paxs.every(pax => evalOne(unit, pax))
      ) return true;
    });
    if (group) return [group];
  }
  return paxs.map(pax => units
    .filter(unit => R.path(['restrictions', 'paxCount'], unit) === 1)
    .find(unit => { // individual units
      return evalOne(unit, pax);
    }));
}

module.exports = Plugin;
module.exports.pickUnit = pickUnit;
