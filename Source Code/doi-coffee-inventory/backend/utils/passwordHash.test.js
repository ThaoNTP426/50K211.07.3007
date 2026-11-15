'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword } = require('./passwordHash');

test('SHA-256 password hashes verify without exposing plaintext comparisons', () => {
    const hash = hashPassword('secret-value');
    assert.match(hash, /^[a-f\d]{64}$/);
    assert.equal(verifyPassword('secret-value', hash), true);
    assert.equal(verifyPassword('wrong-value', hash), false);
});

test('unsupported hash formats fail closed', () => {
    assert.equal(verifyPassword('secret-value', 'legacy-unknown-format'), false);
    assert.equal(verifyPassword(null, 'a'.repeat(64)), false);
});
