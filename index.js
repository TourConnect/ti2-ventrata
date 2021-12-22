const axios = require('axios');
const R = require('ramda');
const Promise = require('bluebird');
const assert = require('assert');
const moment = require('moment');
const jwt = require('jsonwebtoken');
const stringify = require('./utils/stringify.js');
const wildcardMatch = require('./utils/wildcardMatch.js');

const { name: pluginNameParam } = require('./package.json');

const pluginName = pluginNameParam.replace(/@(.+)\//g, '');

const isNilOrEmpty = R.either(R.isNil, R.isEmpty);
const isNilOrEmptyArray = el => {
  if (!Array.isArray(el)) return true;
  return R.isNil(el) || R.isEmpty(el);
}

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

const doMapCurry = mapObj => item => doMap(item, mapObj);

const productMapIn = {
  productId: R.path(['id']),
  productName: R.path(['title']),
  options: e => e.options.map(option => ({
    optionId: R.path(['id'], option),
    optionName: R.path(['title'], option),
  })),
};

const rateMap = {
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
const capitalize = sParam => {
  if (typeof sParam !== 'string') return '';
  let s = sParam.replace(/\_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
};

const optionMap = {
  optionId: R.path(['id']),
  optionName: R.path(['title']),
  units: option => R.pathOr(undefined, ['units'], option).map(unit => doMap(unit, unitMap)),
}

const unitMap = {
  unitId: R.path(['id']),
  unitName: R.path(['title']),
  restrictions: R.path(['restrictions']),
  pricing: R.path(['pricing']),
};

const itineraryMap = {
  name: R.path(['name']),
  type: R.path(['type']),
  address: R.path(['address']),
  coordinates: itinerary => (Boolean(itinerary.latitude)
    && Boolean(itinerary.longitude)) ? doMap(itinerary, {
      lat: R.path(['latitude']),
      long: R.path(['longitude']),
    }) : undefined,
  duration: ({ duration }) => isNilOrEmpty(duration) ? undefined : doMapCurry({
    durationName: R.path(['duration']),
    amount: R.path(['durationAmount']),
    unit: R.path(['durationUnit']),
  }),
};

const unitItemMap = {
  unitItemId: R.path(['uuid']),
  supplierId: R.path(['supplierReference']),
  status: e => capitalize(R.path(['status'], e)),
  contact: R.path(['contact']),
  pricing: R.path(['pricing']),
  unit: unit => doMap(unit, unitMap), 
};


const bookingMap = {
  id: R.path(['id']),
  supplierId: R.path(['supplierReference']),
  status: e => capitalize(R.path(['status'], e)),
  productId: R.path(['product', 'id']),
  productName: R.path(['product', 'title']),
  optionId: R.path(['option', 'id']),
  itinerary: ({ option: { itinerary } = {}}) => 
    isNilOrEmptyArray(itinerary) ? undefined : itinerary.map(doMapCurry(itineraryMap)),
  duration: booking => doMap(booking, {
    durationName: R.path(['duration']),
    amount: R.path(['durationAmount']),
    unit: R.path(['durationUnit']),
  }),
  cancellable: R.path(['cancellable']),
  unitItems: ({ unitItems }) =>
    isNilOrEmptyArray(unitItems) ? undefined : unitItems.map(doMapCurry(unitItemMap)),
  start: R.path(['availability', 'localDateTimeStart']),
  end: R.path(['availability', 'localDateTimeEnd']),
  allDay: R.path(['availability', 'allDay']),
  bookingDate: R.path(['hotel', 'utcCreatedAt']),
  holder: R.path(['contact']),
  telephone: R.pathOr(undefined, ['contact', 'phoneNumber']),
  notes: R.pathOr(undefined, ['notes']),
  price: R.path(['pricing']),
  offer: booking => Boolean(booking.offerCode) ? doMap(booking, {
    offerId: R.path(['offerCode']),
    title: R.pathOr(undefined, ['offerTitle']),
    description: R.pathOr(undefined, ['offer', 'description']),
  }) : undefined,
  cancelPolicy: R.pathOr(undefined, ['product','cancellationPolicy']), // TODO: Looks like cancellation text on appers on the shortDescription of the product entity .. an NLP extractor would be usefull ?
};

const contactMap = {
  fullName: holder => `${holder.name} ${holder.surname}`,
  emailAddress: R.path(['emailAddress']),
  phoneNumber: R.path(['phoneNumber']),
  locales: R.path(['locales']),
  country: R.path(['country']),
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
    if (!isNilOrEmptyArray(payload)) {
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
    if (!isNilOrEmptyArray(payload)) {
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
      quote[productIdIx] = pickUnit(optionDetail.units, occupancies[productIdIx]).map(e => doMap(e, rateMap));
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
      reference,
      holder,
    },
  }) {
    assert(availabilityKey, 'an availability code is required !');
    assert(R.path(['name'], holder), 'a holder\' first name is required');
    assert(R.path(['surname'], holder), 'a holder\' surname is required');
    assert(R.path(['emailAddress'], holder), 'a holder\' email address is required');
    const headers = getHeaders({
      apiKey,
      endpoint,
      octoEnv,
    });
    let url = `${endpoint || this.endpoint}/bookings`;
    let data = await jwt.verify(availabilityKey, this.jwtKey);
    let booking = R.path(['data'], await axios({
      method: 'post',
      url,
      data: { ...data, notes },
      headers,
    }));
    url = `${endpoint || this.endpoint}/bookings/${booking.uuid}/confirm`;
    const contact = doMap(holder, contactMap);
    data = {
      notes,
      contact,
      resellerReference: reference,
    };
    booking = R.path(['data'], await axios({
      method: 'post',
      url,
      data,
      headers,
    }));
    return({ booking: doMap(booking, bookingMap) });
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
