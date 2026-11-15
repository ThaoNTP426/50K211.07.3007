'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateStockTransition } = require('./stockTransition');

test('stock reversal and restore preserve DECIMAL(14,4) arithmetic', () => {
    assert.deepEqual(calculateStockTransition('7.1234', '-2.0001'), {
        before: 7.1234, delta: -2.0001, after: 5.1233
    });
    assert.deepEqual(calculateStockTransition('5.1233', '2.0001'), {
        before: 5.1233, delta: 2.0001, after: 7.1234
    });
});

test('stock transition rejects a negative result and negative current stock', () => {
    assert.throws(() => calculateStockTransition('0.0001', '-0.0002'), /negative stock/);
    assert.throws(() => calculateStockTransition('-0.0001', '1'), /Current stock/);
});
