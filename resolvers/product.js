const { makeExecutableSchema } = require('@graphql-tools/schema');
const R = require('ramda');
const { graphql } = require('graphql');

const resolvers = {
  Query: {
    productId: R.path(['id']),
    productName: o => R.path(['title'], o) || R.prop('internalName', o),
    availableCurrencies: R.path(['availableCurrencies']),
    defaultCurrency: R.path(['defaultCurrency']),
    options: R.propOr([], 'options'),
    settlementMethods: R.path(['settlementMethods']),
  },
  Option: {
    optionId: R.prop('id'),
    optionName: o => R.path(['title'], o) || R.prop('internalName', o),
    units: R.propOr([], 'units'),
  },
  Unit: {
    unitId: R.path(['id']),
    unitName: o => R.path(['title'], o) || R.prop('internalName', o),
    subtitle: R.path(['subtitle']),
    type: R.prop('type'),
    pricing: root => R.path(['pricing'], root) || R.path(['pricingFrom'], root),
    restrictions: R.prop('restrictions'),
  },
};

const translateProduct = async ({
  rootValue,
  typeDefs,
  query,
}) => {
  const schema = makeExecutableSchema({
    typeDefs,
    resolvers,
  });
  const retVal = await graphql({
    schema,
    rootValue,
    source: query,
  });
  if (retVal.errors) throw new Error(retVal.errors);
  return retVal.data;
};

module.exports = {
  translateProduct,
};
