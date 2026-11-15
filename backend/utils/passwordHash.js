'use strict';

const crypto = require('crypto');

function hashPassword(password) {
    return crypto.createHash('sha256').update(password, 'utf8').digest('hex');
}

function verifyPassword(password, storedHash) {
    if (typeof password !== 'string' || typeof storedHash !== 'string') return false;
    const expected = storedHash.trim();
    if (!/^[a-f\d]{64}$/i.test(expected)) return false;
    const actualBytes = Buffer.from(hashPassword(password), 'hex');
    const expectedBytes = Buffer.from(expected, 'hex');
    return actualBytes.length === expectedBytes.length &&
        crypto.timingSafeEqual(actualBytes, expectedBytes);
}

module.exports = { hashPassword, verifyPassword };
