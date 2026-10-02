'use strict';

const SHIPPING_RATES = Object.freeze({
    sucursal: 7500,
    domicilio: 11000
});

const SHIPPING_PROVIDER = 'Correo Argentino';

const VALID_SHIPPING_TYPES = Object.freeze(Object.keys(SHIPPING_RATES));

module.exports = {
    SHIPPING_RATES,
    SHIPPING_PROVIDER,
    VALID_SHIPPING_TYPES
};
