'use strict';

const { decimalToUnits, unitsToNumber } = require('./decimal4');

function calculateStockTransition(currentValue, deltaValue) {
    const beforeUnits = decimalToUnits(currentValue);
    const deltaUnits = decimalToUnits(deltaValue);
    const afterUnits = beforeUnits + deltaUnits;
    if (beforeUnits < 0n) throw new RangeError('Current stock cannot be negative.');
    if (afterUnits < 0n) throw new RangeError('Stock transition cannot result in negative stock.');
    return {
        before: unitsToNumber(beforeUnits),
        delta: unitsToNumber(deltaUnits),
        after: unitsToNumber(afterUnits)
    };
}

module.exports = { calculateStockTransition };
