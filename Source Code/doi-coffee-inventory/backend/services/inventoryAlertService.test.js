'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAlertList } = require('../utils/inventoryAlerts');

test('alert list distinguishes low stock, no stock, expiry, and long stock', () => {
    const alerts = buildAlertList(
        [{ maNVL: 'NVL0001' }],
        [{ maNVL: 'NVL0002' }],
        [{ maNVL: 'NVL0003', maPhieuNhap: 'PN00001', hanSuDung: '2026-11-01' }],
        [{ maNVL: 'NVL0004' }]
    );
    assert.deepEqual(alerts.map(({ type }) => type), ['lowStock', 'outOfStock', 'expiry', 'longStock']);
    assert.equal(alerts[2].key, 'EXPIRY|NVL0003|PN00001|2026-11-01');
});
