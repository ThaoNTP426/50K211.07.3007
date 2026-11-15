'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decimalToUnits, unitsToNumber } = require('./decimal4');

test('decimal values round trip at SQL DECIMAL(14,4) precision', () => {
    for (const value of ['0', '1.2', '1.2345', '-2.0001', 999.9999]) {
        assert.equal(unitsToNumber(decimalToUnits(value)), Number(value));
    }
});

test('decimal parser rejects malformed and over-precision values', () => {
    for (const value of ['', '1e3', '1.23456', 'NaN', null]) {
        assert.throws(() => decimalToUnits(value));
    }
});

test('fractional zeros beyond precision do not change value', () => {
    assert.equal(decimalToUnits('4.250000'), decimalToUnits('4.25'));
});
