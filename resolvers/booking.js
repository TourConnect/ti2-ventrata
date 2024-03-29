const { makeExecutableSchema } = require('@graphql-tools/schema');
const R = require('ramda');
const { graphql } = require('graphql');

const capitalize = sParam => {
  if (typeof sParam !== 'string') return '';
  const s = sParam.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
};
const resolvers = {
  Query: {
    id: R.path(['id']),
    bookingId: R.path(['id']),
    orderId: R.path(['orderId']),
    orderReference: R.path(['orderReference']),
    supplierBookingId: R.path(['supplierReference']),
    resellerReference: R.propOr('', 'resellerReference'),
    status: e => capitalize(R.path(['status'], e)),
    productId: R.path(['product', 'id']),
    productName: root => R.path(['product', 'title'], root) || R.path(['product', 'internalName'], root),
    cancellable: R.path(['cancellable']),
    editable: R.path(['cancellable']),
    unitItems: ({ unitItems }) => unitItems.map(unitItem => ({
      unitItemId: unitItem.uuid,
      unitId: unitItem.unitId,
      unitName: unitItem.title || unitItem.internalName,
    })),
    start: R.path(['availability', 'localDateTimeStart']),
    end: R.path(['availability', 'localDateTimeEnd']),
    allDay: R.path(['availability', 'allDay']),
    bookingDate: R.path(['utcCreatedAt']),
    holder: root => ({
      name: R.pathOr('', ['contact', 'fullName'], root).split(' ')[0],
      surname: R.last(R.pathOr('', ['contact', 'fullName'], root).split(' ')),
      fullName: R.pathOr('', ['contact', 'fullName'], root),
      phoneNumber: R.pathOr('', ['contact', 'phoneNumber'], root),
      emailAddress: R.pathOr('', ['contact', 'emailAddress'], root),
    }),
    notes: root => root.notes || '',
    price: root => root.pricing,
    cancelPolicy: ({ option }) => {
      if (option.cancellationCutoff) {
        return `Cancel up to ${option.cancellationCutoff} before activity starts`;
      }
      return '';
    },
    optionId: R.path(['option', 'id']),
    optionName: root => R.path(['option', 'title'], root) || R.path(['option', 'internalName'], root),
    publicUrl: () => null,
    privateUrl: () => null,
    pickupRequested: R.prop('pickupRequested'),
    pickupPointId: R.prop('pickupPointId'),
    pickupPoint: root => {
      const pickupPoint = R.path(['pickupPoint'], root);
      if (!pickupPoint) return null;
      return {
        ...pickupPoint,
        postal: pickupPoint.postal_code,
      };
    },
  },
};

const translateBooking = async ({ rootValue, typeDefs, query }) => {
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
  translateBooking,
};
