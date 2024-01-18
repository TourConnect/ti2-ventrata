const { makeExecutableSchema } = require('@graphql-tools/schema');
const { graphql } = require('graphql');
const R = require('ramda');
const jwt = require('jsonwebtoken');

const resolvers = {
  Query: {
    key: (root, args) => {
      const {
        productId,
        optionId,
        currency,
        unitsWithQuantity,
        jwtKey,
      } = args;
      if (!jwtKey) return null;
      return jwt.sign({
        productId,
        optionId,
        availabilityId: root.id,
        currency,
        unitItems: R.chain(u => new Array(u.quantity).fill(1).map(() => ({
          unitId: u.unitId,
        })), unitsWithQuantity),
      }, jwtKey);
    },
    dateTimeStart: root => R.path(['localDateTimeStart'], root) || R.path(['localDate'], root),
    dateTimeEnd: root => R.path(['localDateTimeEnd'], root) || R.path(['localDate'], root),
    allDay: R.path(['allDay']),
    vacancies: R.prop('vacancies'),
    available: root => root.status !== 'SOLD_OUT' && root.vacancies > 0,
    offers: root => R.pathOr([], ['offers'], root).map(o => ({
      offerId: o.code,
      title: o.title,
      description: o.description,
    })),
    // get the starting price
    pricing: root => R.prop('pricingFrom', root) || R.prop('pricing', root),
    unitPricing: root => R.prop('unitPricingFrom', root) || R.prop('unitPricing', root),
    pickupAvailable: R.prop('pickupAvailable'),
    pickupRequired: R.prop('pickupRequired'),
    pickupPoints: root => R.pathOr([], ['pickupPoints'], root)
      .map(o => ({
        ...o,
        postal: o.postal_code,
      })),
  },
};

const translateAvailability = async ({ rootValue, variableValues, typeDefs, query }) => {
  const schema = makeExecutableSchema({
    typeDefs,
    resolvers,
  });
  const retVal = await graphql({
    schema,
    rootValue,
    source: query,
    variableValues,
  });
  if (retVal.errors) throw new Error(retVal.errors);
  return retVal.data;
};
module.exports = {
  translateAvailability,
};
