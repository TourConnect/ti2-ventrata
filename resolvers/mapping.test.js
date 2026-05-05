const jwt = require('jsonwebtoken');

const Plugin = require('../index');
const { translateAvailability } = require('./availability');
const { translateBooking } = require('./booking');
const { typeDefs: ti2BookingTypeDefs, query: ti2BookingQuery } = require('../node_modules/ti2/controllers/graphql-schemas/booking');
const { typeDefs: ti2AvailabilityTypeDefs, query: ti2AvailabilityQuery } = require('../node_modules/ti2/controllers/graphql-schemas/availability');

describe('ventrata mappings', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps unit-scoped duplicate question ids in create booking fields', async () => {
    const plugin = new Plugin({
      jwtKey: 'test-jwt-key',
      endpoint: 'https://example.test/octo',
    });
    const axios = jest.fn().mockResolvedValue({
      data: {
        options: [
          {
            id: 'DEFAULT',
            questions: [],
            units: [
              {
                id: 'adult-unit',
                questions: [{ id: 'meal-choice', label: 'Meal', inputType: 'select', selectOptions: [] }],
              },
              {
                id: 'child-unit',
                questions: [{ id: 'meal-choice', label: 'Meal', inputType: 'select', selectOptions: [] }],
              },
            ],
          },
        ],
      },
    });

    const result = await plugin.getCreateBookingFields({
      axios,
      token: { apiKey: 'api-key' },
      query: { productId: 'product-1' },
    });

    expect(result.customFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'meal-choice',
          isPerUnitItem: true,
          unitId: 'adult-unit',
          required: false,
          requiredPerParticipant: false,
          requiredPerBooking: false,
          visiblePerParticipant: true,
          visiblePerBooking: true,
        }),
        expect.objectContaining({
          id: 'meal-choice',
          isPerUnitItem: true,
          unitId: 'child-unit',
          required: false,
          requiredPerParticipant: false,
          requiredPerBooking: false,
          visiblePerParticipant: true,
          visiblePerBooking: true,
        }),
      ]),
    );
  });

  it('maps mandatory flags for booking-level and per-participant questions', async () => {
    const plugin = new Plugin({
      jwtKey: 'test-jwt-key',
      endpoint: 'https://example.test/octo',
    });
    const axios = jest.fn().mockResolvedValue({
      data: {
        options: [
          {
            id: 'DEFAULT',
            questions: [{ id: 'hotel', label: 'Hotel', inputType: 'text', required: true }],
            units: [
              {
                id: 'adult-unit',
                questions: [{ id: 'meal-choice', label: 'Meal', inputType: 'select', required: true, selectOptions: [] }],
              },
            ],
          },
        ],
      },
    });

    const result = await plugin.getCreateBookingFields({
      axios,
      token: { apiKey: 'api-key' },
      query: { productId: 'product-1' },
    });

    expect(result.customFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'hotel',
          required: true,
          requiredPerBooking: true,
          requiredPerParticipant: false,
          visiblePerBooking: true,
          visiblePerParticipant: false,
        }),
        expect.objectContaining({
          id: 'meal-choice',
          unitId: 'adult-unit',
          required: true,
          requiredPerBooking: true,
          requiredPerParticipant: true,
          visiblePerBooking: true,
          visiblePerParticipant: true,
        }),
      ]),
    );
  });

  it('accepts pickupPointId alias when creating booking', async () => {
    const plugin = new Plugin({
      jwtKey: 'test-jwt-key',
      endpoint: 'https://example.test/octo',
    });

    const verifySpy = jest.spyOn(jwt, 'verify').mockReturnValue({
      productId: 'product-1',
      optionId: 'DEFAULT',
      availabilityId: 'avail-1',
      unitItems: [{ unitId: 'adult-unit' }],
      settlementMethods: ['DEFERRED'],
    });

    const axios = jest.fn().mockResolvedValue({
      data: {
        id: 'booking-id',
        orderId: 'order-id',
        orderReference: 'order-ref',
        supplierReference: 'supplier-ref',
        status: 'CONFIRMED',
        product: { id: 'product-1', internalName: 'Product' },
        option: { id: 'DEFAULT', internalName: 'DEFAULT' },
        availability: { localDateTimeStart: '2026-05-02T08:00:00', localDateTimeEnd: '2026-05-02T10:00:00' },
        contact: { fullName: 'Test User' },
        cancellable: true,
        utcCreatedAt: '2026-05-01T00:00:00Z',
        pricing: { retail: 1000 },
        unitItems: [{ uuid: 'unit-item-1', unitId: 'adult-unit', internalName: 'Adult' }],
        pickupRequested: true,
        pickupPointId: 'pickup-123',
        utcConfirmedAt: '2026-05-01T00:00:01Z',
      },
    });

    await plugin.createBooking({
      axios,
      token: { apiKey: 'api-key' },
      payload: {
        availabilityKey: 'signed-key',
        holder: { name: 'Test', surname: 'User', country: 'US' },
        pickupPointId: 'pickup-123',
      },
      typeDefsAndQueries: {
        bookingTypeDefs: ti2BookingTypeDefs,
        bookingQuery: ti2BookingQuery,
      },
    });

    expect(verifySpy).toHaveBeenCalledWith('signed-key', 'test-jwt-key');
    const createBookingCall = axios.mock.calls.find(call => call[0].url === 'https://example.test/octo/bookings');
    expect(createBookingCall).toBeTruthy();
    expect(createBookingCall[0].data).toEqual(
      expect.objectContaining({
        pickupRequested: true,
        pickupPointId: 'pickup-123',
      }),
    );
  });

  it('maps participant-scoped custom fields from standard ti2 payload into unitItems questionAnswers', async () => {
    const plugin = new Plugin({
      jwtKey: 'test-jwt-key',
      endpoint: 'https://example.test/octo',
    });

    jest.spyOn(jwt, 'verify').mockReturnValue({
      productId: 'product-1',
      optionId: 'DEFAULT',
      availabilityId: 'avail-1',
      unitItems: [
        { unitId: 'adult-unit' },
        { unitId: 'adult-unit' },
      ],
      settlementMethods: ['DEFERRED'],
    });

    const axios = jest.fn().mockResolvedValue({
      data: {
        id: 'booking-id',
        orderId: 'order-id',
        orderReference: 'order-ref',
        supplierReference: 'supplier-ref',
        status: 'CONFIRMED',
        product: { id: 'product-1', internalName: 'Product' },
        option: { id: 'DEFAULT', internalName: 'DEFAULT' },
        availability: { localDateTimeStart: '2026-05-02T08:00:00', localDateTimeEnd: '2026-05-02T10:00:00' },
        contact: { fullName: 'Test User' },
        cancellable: true,
        utcCreatedAt: '2026-05-01T00:00:00Z',
        pricing: { retail: 1000 },
        unitItems: [{ uuid: 'unit-item-1', unitId: 'adult-unit', internalName: 'Adult' }],
        utcConfirmedAt: '2026-05-01T00:00:01Z',
      },
    });

    await plugin.createBooking({
      axios,
      token: { apiKey: 'api-key' },
      payload: {
        availabilityKey: 'signed-key',
        holder: { name: 'Test', surname: 'User', country: 'US' },
        customFieldValues: [
          {
            field: { id: 'specialReq', isPerUnitItem: false },
            value: 'Window seat',
          },
        ],
        participants: [
          {
            fields: [
              {
                field: { id: 'dietary', isPerUnitItem: true, unitId: 'adult-unit' },
                value: 'Vegan',
              },
            ],
          },
          {
            fields: [
              {
                field: { id: 'dietary', isPerUnitItem: true, unitId: 'adult-unit' },
                value: 'Gluten-free',
              },
            ],
          },
        ],
      },
      typeDefsAndQueries: {
        bookingTypeDefs: ti2BookingTypeDefs,
        bookingQuery: ti2BookingQuery,
      },
    });

    const createBookingCall = axios.mock.calls.find(call => call[0].url === 'https://example.test/octo/bookings');
    expect(createBookingCall).toBeTruthy();
    expect(createBookingCall[0].data.questionAnswers).toEqual(
      expect.arrayContaining([
        {
          questionId: 'specialReq',
          value: 'Window seat',
        },
      ]),
    );
    expect(createBookingCall[0].data.unitItems).toEqual([
      {
        unitId: 'adult-unit',
        questionAnswers: [
          {
            questionId: 'dietary',
            value: 'Vegan',
          },
        ],
      },
      {
        unitId: 'adult-unit',
        questionAnswers: [
          {
            questionId: 'dietary',
            value: 'Gluten-free',
          },
        ],
      },
    ]);
  });

  it('normalizes object-like custom-field values to scalar questionAnswers values', async () => {
    const plugin = new Plugin({
      jwtKey: 'test-jwt-key',
      endpoint: 'https://example.test/octo',
    });

    jest.spyOn(jwt, 'verify').mockReturnValue({
      productId: 'product-1',
      optionId: 'DEFAULT',
      availabilityId: 'avail-1',
      unitItems: [{ unitId: 'adult-unit' }],
      settlementMethods: ['DEFERRED'],
    });

    const axios = jest.fn().mockResolvedValue({
      data: {
        id: 'booking-id',
        orderId: 'order-id',
        orderReference: 'order-ref',
        supplierReference: 'supplier-ref',
        status: 'CONFIRMED',
        product: { id: 'product-1', internalName: 'Product' },
        option: { id: 'DEFAULT', internalName: 'DEFAULT' },
        availability: { localDateTimeStart: '2026-05-02T08:00:00', localDateTimeEnd: '2026-05-02T10:00:00' },
        contact: { fullName: 'Test User' },
        cancellable: true,
        utcCreatedAt: '2026-05-01T00:00:00Z',
        pricing: { retail: 1000 },
        unitItems: [{ uuid: 'unit-item-1', unitId: 'adult-unit', internalName: 'Adult' }],
        utcConfirmedAt: '2026-05-01T00:00:01Z',
      },
    });

    const lunchSelection = 'Green Salad (Gluten Free) - romaine lettuce diced tomato green onion cucumber diced chicken & french dressing';

    await plugin.createBooking({
      axios,
      token: { apiKey: 'api-key' },
      payload: {
        availabilityKey: 'signed-key',
        holder: { name: 'Test', surname: 'User', country: 'US' },
        customFieldValues: [
          {
            field: { id: '8959d9a0-cb46-4f29-97fa-e07ce7f961da', isPerUnitItem: false },
            value: {
              label: lunchSelection,
              value: lunchSelection,
              userInput: true,
            },
          },
        ],
      },
      typeDefsAndQueries: {
        bookingTypeDefs: ti2BookingTypeDefs,
        bookingQuery: ti2BookingQuery,
      },
    });

    const createBookingCall = axios.mock.calls.find(call => call[0].url === 'https://example.test/octo/bookings');
    expect(createBookingCall).toBeTruthy();
    expect(createBookingCall[0].data.questionAnswers).toEqual(
      expect.arrayContaining([
        {
          questionId: '8959d9a0-cb46-4f29-97fa-e07ce7f961da',
          value: lunchSelection,
        },
      ]),
    );
  });

  it('normalizes pickup point fields for availability and booking translations', async () => {
    const availability = await translateAvailability({
      rootValue: {
        pickupPoints: [
          {
            id: 'pickup-1',
            postalCode: 'T1L',
            locality: 'Banff',
            region: 'Alberta',
            localDateTimeStart: '2026-05-02T08:00:00',
          },
        ],
      },
      variableValues: {
        productId: 'product-1',
        optionId: 'DEFAULT',
        unitsWithQuantity: [],
        currency: 'CAD',
        jwtKey: '',
      },
      typeDefs: ti2AvailabilityTypeDefs,
      query: ti2AvailabilityQuery,
    });
    expect(availability.pickupPoints[0]).toEqual(expect.objectContaining({
      postal: 'T1L',
      city: 'Banff',
      state: 'Alberta',
      localDateTime: '2026-05-02T08:00:00',
    }));

    const booking = await translateBooking({
      rootValue: {
        id: 'booking-2',
        status: 'CONFIRMED',
        unitItems: [],
        option: {
          id: 'DEFAULT',
          internalName: 'DEFAULT',
          cancellationCutoff: '',
        },
        product: { id: 'product-1', internalName: 'Product' },
        availability: {},
        contact: {},
        pricing: {},
        voucher: {
          deliveryOptions: [
            {
              deliveryFormat: 'PDF_URL',
              deliveryValue: 'https://api.ventrata.com/octo/pdf?booking=booking-2',
            },
          ],
        },
        pickupPoint: {
          id: 'pickup-2',
          postalCode: 'T2E 7Y5',
          locality: 'Calgary',
          region: 'Alberta',
        },
      },
      typeDefs: ti2BookingTypeDefs,
      query: ti2BookingQuery,
    });
    expect(booking.pickupPoint).toEqual(expect.objectContaining({
      postal: 'T2E 7Y5',
      city: 'Calgary',
      state: 'Alberta',
    }));
    expect(booking.publicUrl).toBe('https://api.ventrata.com/octo/pdf?booking=booking-2');
    expect(booking.privateUrl).toBe('https://api.ventrata.com/octo/pdf?booking=booking-2');
  });
});
