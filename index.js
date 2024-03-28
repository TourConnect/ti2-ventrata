const R = require('ramda');
const Promise = require('bluebird');
const assert = require('assert');
const moment = require('moment');
const jwt = require('jsonwebtoken');
const wildcardMatch = require('./utils/wildcardMatch');
const { translateProduct } = require('./resolvers/product');
const { translateAvailability } = require('./resolvers/availability');
const { translateBooking } = require('./resolvers/booking');
const { translatePickupPoint } = require('./resolvers/pickup-point');

const CONCURRENCY = 3; // is this ok ?

const isNilOrEmpty = R.either(R.isNil, R.isEmpty);

const getHeaders = ({
  apiKey,
  acceptLanguage,
  octoEnv,
  // resellerId,
}) => ({
  Authorization: `Bearer ${apiKey}`,
  ...octoEnv ? { 'Octo-Env': octoEnv } : {},
  ...acceptLanguage ? { 'Accept-Language': acceptLanguage } : {},
  'Content-Type': 'application/json',
  // ...resellerId ? { Referer: resellerId } : {},+
  'Octo-Capabilities': 'octo/pricing,octo/pickups,octo/cart,octo/offers,octo/questions',
  // 'Octo-Capabilities': 'octo/pricing',
});

class Plugin {
  constructor(params) { // we get the env variables from here
    Object.entries(params).forEach(([attr, value]) => {
      this[attr] = value;
    });

    this.tokenTemplate = () => ({
      apiKey: {
        type: 'text',
        regExp: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
        description: 'the Api Key provided from Ventrata, should be in uuid format',
      },
      resellerId: {
        type: 'text',
        regExp: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
        description: 'the Reseller Id provided from Ventrata, should be in uuid format',
      },
      endpoint: {
        type: 'text',
        regExp: /^(?!mailto:)(?:(?:http|https|ftp):\/\/)(?:\S+(?::\S*)?@)?(?:(?:(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[0-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]+-?)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]+-?)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,})))|localhost)(?::\d{2,5})?(?:(\/|\?|#)[^\s]*)?$/i,
        default: 'https://api.ventrata.com/octo',
        description: 'The url api endpoint from Ventata',
      },
      octoEnv: {
        type: 'text',
        list: ['live', 'test'],
        regExp: /^(live|test)$/,
        description: 'If on test it will not consume any availability, the barcodes will not work, and you will not be invoiced for it',
        default: 'live',
      },
      acceptLanguage: {
        type: 'text',
        regExp: /^[a-z]{2}$/,
        description: 'This conforms to the regular HTTP specification for language but if the supplier has translated their content it will return the content in the specified language if possible',
        default: 'en',
      },
    });
    this.errorPathsAxiosErrors = () => ([ // axios triggered errors
      ['response', 'data', 'errorMessage'],
    ]);
    this.errorPathsAxiosAny = () => ([]); // 200's that should be errors
  }

  async validateToken({
    axios,
    token: {
      apiKey,
      endpoint,
      octoEnv,
      acceptLanguage,
      resellerId,
    },
  }) {
    const url = `${endpoint || this.endpoint}/whoami?token=${apiKey}`;
    const headers = getHeaders({
      apiKey,
      endpoint,
      octoEnv,
      acceptLanguage,
      resellerId,
    });
    try {
      const connectionId = R.path(['data', 'connection', 'id'], await axios({
        method: 'get',
        url,
        headers,
      }));
      return /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/.test(connectionId);
    } catch (err) {
      return false;
    }
  }

  async searchProducts({
    axios,
    token: {
      apiKey,
      endpoint,
      octoEnv,
      acceptLanguage,
      resellerId,
    },
    payload,
    typeDefsAndQueries: {
      productTypeDefs,
      productQuery,
    },
  }) {
    let url = `${endpoint || this.endpoint}/products`;
    if (!isNilOrEmpty(payload)) {
      if (payload.productId) {
        url = `${url}/${payload.productId}`;
      }
    }
    const headers = getHeaders({
      apiKey,
      endpoint,
      octoEnv,
      acceptLanguage,
      resellerId,
    });
    let results = R.pathOr([], ['data'], await axios({
      method: 'get',
      url,
      headers,
    }));
    if (!Array.isArray(results)) results = [results];
    let products = await Promise.map(
      results,
      product => translateProduct({
        rootValue: product,
        typeDefs: productTypeDefs,
        query: productQuery,
      }),
    );
    // dynamic extra filtering
    if (!isNilOrEmpty(payload)) {
      const extraFilters = R.omit(['productId'], payload);
      if (Object.keys(extraFilters).length > 0) {
        products = products.filter(
          product => Object.entries(extraFilters).every(
            ([key, value]) => {
              if (typeof value === 'string') return wildcardMatch(value, product[key]);
              return true;
            },
          ),
        );
      }
    }
    return ({ products });
  }

  async searchQuote({
    // token: {
    //   apiKey,
    //   endpoint,
    //   octoEnv,
    //   acceptLanguage,
    //   resellerId,
    // },
    // payload: {
    //   productIds,
    //   optionIds,
    //   occupancies,
    // },
  }) {
    return { quote: [] };
  }

  async searchAvailability({
    axios,
    token: {
      apiKey,
      endpoint,
      octoEnv,
      acceptLanguage,
      resellerId,
    },
    payload: {
      productIds,
      optionIds,
      units,
      startDate,
      endDate,
      dateFormat,
      currency,
    },
    typeDefsAndQueries: {
      availTypeDefs,
      availQuery,
    },
  }) {
    assert(this.jwtKey, 'JWT secret should be set');
    assert(
      productIds.length === optionIds.length,
      'mismatched productIds/options length',
    );
    assert(
      optionIds.length === units.length,
      'mismatched options/units length',
    );
    assert(productIds.every(Boolean), 'some invalid productId(s)');
    assert(optionIds.every(Boolean), 'some invalid optionId(s)');
    const localDateStart = moment(startDate, dateFormat).format('YYYY-MM-DD');
    const localDateEnd = moment(endDate, dateFormat).format('YYYY-MM-DD');
    const headers = getHeaders({
      apiKey,
      endpoint,
      octoEnv,
      acceptLanguage,
      resellerId,
    });
    const url = `${endpoint || this.endpoint}/availability`;
    const availability = (
      await Promise.map(productIds, async (productId, ix) => {
        const data = {
          productId,
          optionId: optionIds[ix],
          localDateStart,
          localDateEnd,
          units: units[ix].map(u => ({ id: u.unitId, quantity: u.quantity })),
        };
        if (currency) data.currency = currency;
        const result = R.path(['data'], await axios({
          method: 'post',
          url,
          data,
          headers,
        }));
        return Promise.map(result, avail => translateAvailability({
          typeDefs: availTypeDefs,
          query: availQuery,
          rootValue: avail,
          variableValues: {
            productId,
            optionId: optionIds[ix],
            currency,
            unitsWithQuantity: units[ix],
            jwtKey: this.jwtKey,
          },
        }));
      }, { concurrency: CONCURRENCY })
    );
    return { availability };
  }

  async availabilityCalendar({
    axios,
    token: {
      apiKey,
      endpoint,
      octoEnv,
      acceptLanguage,
      resellerId,
    },
    payload: {
      productIds,
      optionIds,
      units,
      startDate,
      endDate,
      currency,
      dateFormat,
    },
    typeDefsAndQueries: {
      availTypeDefs,
      availQuery,
    },
  }) {
    assert(this.jwtKey, 'JWT secret should be set');
    assert(
      productIds.length === optionIds.length,
      'mismatched productIds/options length',
    );
    assert(
      optionIds.length === units.length,
      'mismatched options/units length',
    );
    assert(productIds.every(Boolean), 'some invalid productId(s)');
    assert(optionIds.every(Boolean), 'some invalid optionId(s)');
    const localDateStart = moment(startDate, dateFormat).format('YYYY-MM-DD');
    const localDateEnd = moment(endDate, dateFormat).format('YYYY-MM-DD');
    const headers = getHeaders({
      apiKey,
      endpoint,
      octoEnv,
      acceptLanguage,
      resellerId,
    });
    const url = `${endpoint || this.endpoint}/availability/calendar`;
    const availability = (
      await Promise.map(productIds, async (productId, ix) => {
        const data = {
          productId,
          optionId: optionIds[ix],
          localDateStart,
          localDateEnd,
          // units is required here to get the total pricing for the calendar
          units: units[ix].map(u => ({ id: u.unitId, quantity: u.quantity })),
        };
        if (currency) data.currency = currency;
        const result = await axios({
          method: 'post',
          url,
          data,
          headers,
        });
        return Promise.map(result.data, avail => translateAvailability({
          rootValue: avail,
          typeDefs: availTypeDefs,
          query: availQuery,
        }));
      }, { concurrency: CONCURRENCY })
    );
    return { availability };
  }

  async createBooking({
    axios,
    token: {
      apiKey,
      endpoint,
      octoEnv,
      acceptLanguage,
    },
    payload: {
      orderId,
      partialOrder,
      rebookingId,
      availabilityKey,
      holder,
      notes,
      reference,
      pickupPoint,
      customFieldValues,
    },
    typeDefsAndQueries: {
      bookingTypeDefs,
      bookingQuery,
    },
  }) {
    assert(availabilityKey, 'an availability code is required !');
    assert(R.path(['name'], holder), 'First Name is required');
    assert(R.path(['surname'], holder), 'Last Name is required');
    const headers = getHeaders({
      apiKey,
      endpoint,
      octoEnv,
      acceptLanguage,
    });
    const dataForCreateBooking = await jwt.verify(availabilityKey, this.jwtKey);
    // if customFieldValues contains perUnitItem fields
    // we need to overwrite unitItems from the availabilityKey
    if (customFieldValues && customFieldValues.length) {
      const productCFV = customFieldValues.filter(o => !R.isNil(o.value) && !o.field.isPerUnitItem);
      const unitItemCFV = customFieldValues.filter(o => !R.isNil(o.value) && o.field.isPerUnitItem);
      if (productCFV.length) {
        dataForCreateBooking.questionAnswers = productCFV.map(o => ({
          questionId: o.field.id,
          value: o.value,
        }));
      }
      if (unitItemCFV.length) {
        dataForCreateBooking.unitItems = R.call(R.compose(
          R.map(arr => ({
            unitId: arr[0].field.unitId,
            questionAnswers: arr.map(o => ({
              questionId: o.field.id.split('|')[0],
              value: o.value,
            })),
          })),
          R.values,
          R.groupBy(o => {
            const [questionId, unitItemIndex] = o.field.id.split('|');
            return unitItemIndex;
          }),
        ), unitItemCFV);
      }
    }
    let booking = R.path(['data'], await axios({
      method: rebookingId ? 'patch' : 'post',
      url: `${endpoint || this.endpoint}/bookings${rebookingId ? `/${rebookingId}` : ''}`,
      data: {
        orderId,
        settlementMethod: reference ? 'VOUCHER' : 'DEFERRED',
        ...dataForCreateBooking,
        notes,
        ...(pickupPoint ? { pickupRequested: true, pickupPointId: pickupPoint } : {}),
      },
      headers,
    }));
    // for booking update, we may not need to confirm again
    if (!booking.utcConfirmedAt && !partialOrder) {
      const dataForConfirmBooking = {
        contact: {
          fullName: `${holder.name} ${holder.surname}`,
          emailAddress: R.path(['emailAddress'], holder),
          phoneNumber: R.path(['phone'], holder),
          locales: R.path(['locales'], holder),
          country: R.path(['country'], holder),
        },
        notes,
        resellerReference: reference,
        settlementMethod: reference ? 'VOUCHER' : 'DEFERRED',
      };
      booking = R.path(['data'], await axios({
        method: 'post',
        url: `${endpoint || this.endpoint}/bookings/${booking.uuid}/confirm`,
        data: dataForConfirmBooking,
        headers,
      }));
    }
    return ({
      booking: await translateBooking({
        rootValue: booking,
        typeDefs: bookingTypeDefs,
        query: bookingQuery,
      }),
    });
  }

  async cancelBooking({
    axios,
    token: {
      apiKey,
      endpoint,
      octoEnv,
      acceptLanguage,
      resellerId,
    },
    payload: {
      bookingId,
      id,
      reason,
    },
    typeDefsAndQueries: {
      bookingTypeDefs,
      bookingQuery,
    },
  }) {
    assert(!isNilOrEmpty(bookingId) || !isNilOrEmpty(id), 'Invalid booking id');
    const headers = getHeaders({
      apiKey,
      endpoint,
      octoEnv,
      acceptLanguage,
      resellerId,
    });
    const url = `${endpoint || this.endpoint}/bookings/${bookingId || id}`;
    const booking = R.path(['data'], await axios({
      method: 'delete',
      url,
      data: { reason },
      headers,
    }));
    return ({
      cancellation: await translateBooking({
        rootValue: booking,
        typeDefs: bookingTypeDefs,
        query: bookingQuery,
      }),
    });
  }

  async searchBooking({
    axios,
    token: {
      apiKey,
      endpoint,
      octoEnv,
      acceptLanguage,
      resellerId,
    },
    payload: {
      bookingId,
      resellerReference,
      supplierBookingId,
      travelDateStart,
      travelDateEnd,
      dateFormat,
    },
    typeDefsAndQueries: {
      bookingTypeDefs,
      bookingQuery,
    },
  }) {
    assert(
      !isNilOrEmpty(bookingId)
      || !isNilOrEmpty(resellerReference)
      || !isNilOrEmpty(supplierBookingId)
      || !(
        isNilOrEmpty(travelDateStart) && isNilOrEmpty(travelDateEnd) && isNilOrEmpty(dateFormat)
      ),
      'at least one parameter is required',
    );
    const headers = getHeaders({
      apiKey,
      endpoint,
      octoEnv,
      acceptLanguage,
      resellerId,
    });
    const searchByUrl = async url => {
      try {
        return R.path(['data'], await axios({
          method: 'get',
          url,
          headers,
        }));
      } catch (err) {
        return [];
      }
    };
    const bookings = await (async () => {
      let url;
      if (!isNilOrEmpty(bookingId)) {
        return Promise.all([
          searchByUrl(`${endpoint || this.endpoint}/bookings/${bookingId}`),
          searchByUrl(`${endpoint || this.endpoint}/bookings?resellerReference=${bookingId}`),
          searchByUrl(`${endpoint || this.endpoint}/bookings?supplierReference=${bookingId}`),
        ]);
      }
      if (!isNilOrEmpty(resellerReference)) {
        url = `${endpoint || this.endpoint}/bookings?resellerReference=${resellerReference}`;
        return R.path(['data'], await axios({
          method: 'get',
          url,
          headers,
        }));
      }
      if (!isNilOrEmpty(supplierBookingId)) {
        url = `${endpoint || this.endpoint}/bookings?supplierReference=${supplierBookingId}`;
        return R.path(['data'], await axios({
          method: 'get',
          url,
          headers,
        }));
      }
      if (!isNilOrEmpty(travelDateStart)) {
        const localDateStart = moment(travelDateStart, dateFormat).format();
        const localDateEnd = moment(travelDateEnd, dateFormat).format();
        url = `${endpoint || this.endpoint}/bookings?localDateStart=${encodeURIComponent(localDateStart)}&localDateEnd=${encodeURIComponent(localDateEnd)}`;
        return R.path(['data'], await axios({
          method: 'get',
          url,
          headers,
        }));
      }
      return [];
    })();
    return ({
      bookings: await Promise.map(R.flatten(bookings), booking => translateBooking({
        rootValue: booking,
        typeDefs: bookingTypeDefs,
        query: bookingQuery,
      })),
    });
  }

  async getPickupPoints({
    axios,
    token: {
      apiKey,
      endpoint,
      octoEnv,
      acceptLanguage,
      resellerId,
    },
    typeDefsAndQueries: {
      pickupTypeDefs,
      pickupQuery,
    },
  }) {
    const url = `${endpoint || this.endpoint}/products`;
    const headers = getHeaders({
      apiKey,
      endpoint,
      octoEnv,
      acceptLanguage,
      resellerId,
    });
    const products = R.pathOr([], ['data'], await axios({
      method: 'get',
      url,
      headers,
    }));
    const pickupPoints = R.call(R.compose(
      R.uniqBy(R.prop('id')),
      R.chain(R.propOr([], 'pickupPoints')),
      R.filter(o => o.pickupPoints && o.pickupPoints.length),
      R.chain(R.propOr([], 'options')),
    ), products);
    return {
      pickupPoints: await Promise.map(pickupPoints, async pickup => translatePickupPoint({
        rootValue: pickup,
        typeDefs: pickupTypeDefs,
        query: pickupQuery,
      })),
    };
  }

  // eslint-disable-next-line class-methods-use-this
  async getCreateBookingFields({
    axios,
    token: {
      apiKey,
      endpoint,
      octoEnv,
      acceptLanguage,
      resellerId,
    },
    query: {
      productId,
    },
  }) {
    const headers = getHeaders({
      apiKey,
      endpoint,
      octoEnv,
      acceptLanguage,
      resellerId,
    });
    const convertQToField = o => ({
      id: o.id,
      subtitle: o.description === o.label ? '' : o.description,
      title: o.label,
      type: (() => {
        if (o.inputType === 'radio') return 'radio';
        if (Array.isArray(o.selectOptions) && o.selectOptions.length) return 'extended-option';
        if (o.inputType === 'number') return 'count';
        if (o.inputType === 'text') return 'long';
        if (o.inputType === 'textarea') return 'long';
        return 'long';
      })(),
      options: o.selectOptions,
      isPerUnitItem: o.isPerUnitItem,
    });
    if (!productId) {
      const allProducts = R.pathOr([], ['data'], await axios({
        method: 'get',
        url: `${endpoint || this.endpoint}/products`,
        headers,
      }));
      const allOptions = R.chain(R.propOr([], 'options'), allProducts);
      const allUnits = R.chain(R.propOr([], 'units'), allOptions).map(o => ({ ...o, isPerUnitItem: true }));
      const allQuestions = R.call(R.compose(
        R.uniqBy(R.prop('id')),
        R.chain(obj => (obj.questions || []).map(q => ({
          ...q,
          isPerUnitItem: Boolean(obj.isPerUnitItem),
        }))),
        R.filter(o => o.questions && o.questions.length),
      ), [...allOptions, ...allUnits]);
      return {
        fields: [],
        customFields: allQuestions.map(convertQToField),
      };
    }
    const url = `${endpoint || this.endpoint}/products/${productId}`;
    const product = R.pathOr([], ['data'], await axios({
      method: 'get',
      url,
      headers,
    }));

    const allOptions = R.propOr([], 'options', product);
    const allQuestions = R.call(R.compose(
      R.uniqBy(R.prop('id')),
      R.chain(obj => (obj.questions || []).map(q => ({
        ...q,
        isPerUnitItem: Boolean(obj.isPerUnitItem),
      }))),
      R.filter(o => o.questions && o.questions.length),
    ), [
      ...allOptions,
      ...R.chain(R.propOr([], 'units'), allOptions).map(o => ({ ...o, isPerUnitItem: true })),
    ]);
    if (!product) return { fields: [] };
    return {
      fields: [],
      customFields: allQuestions.map(convertQToField),
    };
  }
}

module.exports = Plugin;
