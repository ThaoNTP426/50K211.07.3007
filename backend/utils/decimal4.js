'use strict';

const SCALE = 10000n;

function decimalToUnits(value) {
    if (typeof value !== 'string' && typeof value !== 'number') {
        throw new TypeError('Quantity must be a string or number.');
    }

    const text = String(value).trim();
    const match = text.match(/^([+-]?)(\d+)(?:\.(\d*))?$/);

    if (!match) {
        throw new TypeError('Quantity must be a plain decimal value.');
    }

    const fraction = match[3] || '';
    if (fraction.length > 4 && /[1-9]/.test(fraction.slice(4))) {
        throw new RangeError('Quantity supports at most 4 decimal places.');
    }

    const units = BigInt(match[2]) * SCALE +
        BigInt(fraction.slice(0, 4).padEnd(4, '0') || '0');

    return match[1] === '-' ? -units : units;
}

function unitsToNumber(units) {
    return Number(units) / Number(SCALE);
}

module.exports = { decimalToUnits, unitsToNumber };
