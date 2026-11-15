'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { insertInventoryHistory } = require('./inventoryHistoryInstrumentation');

test('history instrumentation logs exact movement details and SQL CHECK failures', async () => {
    const originalInfo = console.info;
    const originalError = console.error;
    const infoLogs = [];
    const errorLogs = [];
    console.info = (...args) => infoLogs.push(args);
    console.error = (...args) => errorLogs.push(args);

    const sqlError = Object.assign(
        new Error('The INSERT statement conflicted with CHECK constraint CK_LSK_Loai.'),
        { number: 547 }
    );

    try {
        await assert.rejects(
            insertInventoryHistory(
                { query: async () => { throw sqlError; } },
                'INSERT dbo.LICHSUTONKHO ...',
                {
                    api: 'DELETE /api/receipts/PN00001',
                    operation: 'receipt.delete',
                    maPhieu: 'PN00001',
                    maThamChieu: 'PN00001',
                    maLichSuGoc: 52,
                    maNVL: 'NVL0001',
                    loaiBienDong: 'Đảo ngược'
                }
            ),
            (error) => error === sqlError
        );
    } finally {
        console.info = originalInfo;
        console.error = originalError;
    }

    const attempt = JSON.parse(infoLogs[0][1]);
    assert.equal(infoLogs[0][0], '[LICHSUTONKHO INSERT ATTEMPT]');
    assert.equal(attempt.api, 'DELETE /api/receipts/PN00001');
    assert.equal(attempt.maLichSuGoc, 52);
    assert.equal(attempt.loaiBienDong.value, 'Đảo ngược');
    assert.equal(attempt.loaiBienDong.characterLength, 9);
    assert.deepEqual(attempt.loaiBienDong.unicodeCodePoints, [
        'U+0110', 'U+1EA3', 'U+006F', 'U+0020', 'U+006E', 'U+0067', 'U+01B0', 'U+1EE3', 'U+0063'
    ]);

    const failure = JSON.parse(errorLogs[0][1]);
    assert.equal(errorLogs[0][0], '[LICHSUTONKHO CHECK CONSTRAINT ERROR]');
    assert.equal(failure.operation, 'receipt.delete');
    assert.equal(failure.maPhieu, 'PN00001');
    assert.equal(failure.sqlErrorNumber, 547);
    assert.match(failure.sqlErrorMessage, /CK_LSK_Loai/);
});
