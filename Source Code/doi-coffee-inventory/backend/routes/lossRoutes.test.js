'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sqlModulePath = require.resolve('mssql/msnodesqlv8');
const databaseModulePath = require.resolve('../config/database');
const capturedInputs = [];
const capturedQueries = [];
const cancellationTransactions = [];
let cancellationScenario = null;

const fakeSql = {
    Date: 'date',
    Char: (length) => `char(${length})`,
    VarChar: (length) => `varchar(${length})`,
    NVarChar: (length) => `nvarchar(${length})`,
    BigInt: 'bigint',
    Decimal: (precision, scale) => `decimal(${precision},${scale})`,
    Transaction: class MockTransaction {
        constructor() {
            this.commits = 0;
            this.rollbacks = 0;
            cancellationTransactions.push(this);
        }
        async begin() {}
        async commit() { this.commits += 1; }
        async rollback() { this.rollbacks += 1; }
        request() {
            return {
                input(name, type, value) {
                    capturedInputs.push({ name, type, value });
                    return this;
                },
                async query(query) {
                    capturedQueries.push(query);
                    if (cancellationScenario && query.includes('SELECT maPhieuHaoHut, trangThai')) {
                        return { recordset: cancellationScenario.header ? [cancellationScenario.header] : [] };
                    }
                    if (cancellationScenario && query.includes('SELECT maNVL, soLuong')) {
                        return { recordset: cancellationScenario.details || [] };
                    }
                    if (cancellationScenario && query.includes('SELECT maNVL, MAX(maLichSu)')) {
                        return { recordset: cancellationScenario.sourceHistory || [] };
                    }
                    if (cancellationScenario && query.includes('SELECT tonHienTai')) {
                        return { recordset: [{ tonHienTai: 10 }] };
                    }
                    if (cancellationScenario && query.includes('UPDATE NGUYENVATLIEU')) {
                        return { recordset: [] };
                    }
                    if (cancellationScenario && query.includes('UPDATE PHIEUHAOHUT')) {
                        return { recordset: cancellationScenario.updatedHeader ? [cancellationScenario.updatedHeader] : [] };
                    }
                    if (query.includes('SELECT @soMa')) {
                        return { recordset: [{ maPhieuHaoHut: 'HH00001' }] };
                    }
                    if (query.includes('SELECT tonHienTai')) {
                        return { recordset: [{ tonHienTai: 10 }] };
                    }
                    return { recordset: [] };
                }
            };
        }
    }
};

require.cache[sqlModulePath] = {
    id: sqlModulePath,
    filename: sqlModulePath,
    loaded: true,
    exports: fakeSql
};
require.cache[databaseModulePath] = {
    id: databaseModulePath,
    filename: databaseModulePath,
    loaded: true,
    exports: { poolPromise: Promise.resolve({}) }
};

const router = require('./lossRoutes');
const postLayer = router.stack.find((layer) =>
    layer.route?.path === '/' && layer.route.methods.post
);
const postHandler = postLayer.route.stack[0].handle;
const cancelLayer = router.stack.find((layer) =>
    layer.route?.path === '/:id/cancel' && layer.route.methods.patch
);
const cancelHandler = cancelLayer.route.stack[0].handle;

async function post(body) {
    let statusCode = 200;
    let responseBody;
    const response = {
        status(code) { statusCode = code; return this; },
        json(value) { responseBody = value; return this; }
    };
    await postHandler({ body, method: 'POST', originalUrl: '/api/losses' }, response);
    return { statusCode, body: responseBody };
}

async function cancel(id) {
    let statusCode = 200;
    let responseBody;
    const response = {
        status(code) { statusCode = code; return this; },
        json(value) { responseBody = value; return this; }
    };
    await cancelHandler({ params: { id }, method: 'PATCH', originalUrl: `/api/losses/${id}/cancel` }, response);
    return { statusCode, body: responseBody };
}

test('PATCH /api/losses/:id/cancel preserves the full slip ID and confirms persisted state before success', async () => {
    capturedInputs.length = 0;
    capturedQueries.length = 0;
    cancellationTransactions.length = 0;
    cancellationScenario = {
        header: { maPhieuHaoHut: 'HH000007', trangThai: 'Hoàn thành' },
        details: [{ maNVL: 'NVL0001', soLuong: 2 }],
        sourceHistory: [{ maNVL: 'NVL0001', maLichSuGoc: 11, nguonTacDong: 'Tạo phiếu hao hụt' }],
        updatedHeader: { maPhieuHaoHut: 'HH000007', trangThai: 'Đã hủy' }
    };

    const result = await cancel('HH000007');

    assert.equal(result.statusCode, 200);
    assert.equal(result.body.success, true);
    assert.deepEqual(result.body.data, { maPhieuHaoHut: 'HH000007', trangThai: 'Đã hủy' });
    assert.ok(capturedInputs.filter((input) => input.name === 'maPhieu').every((input) => input.type === 'varchar(20)' && input.value === 'HH000007'));
    assert.ok(capturedQueries.some((query) => query.includes('UPDLOCK, HOLDLOCK')));
    assert.ok(capturedQueries.some((query) => query.includes("nguonTacDong IN (N'Phiếu hao hụt', N'Tạo phiếu hao hụt')")));
    assert.ok(capturedQueries.some((query) => query.includes('OUTPUT INSERTED.maPhieuHaoHut, INSERTED.trangThai')));
    assert.equal(cancellationTransactions.at(-1).commits, 1);
    assert.equal(cancellationTransactions.at(-1).rollbacks, 0);
});

test('PATCH /api/losses/:id/cancel rejects missing or already-cancelled slips without inventory reversal', async (t) => {
    for (const scenario of [
        { name: 'missing slip', header: null, message: 'Không tìm thấy phiếu hao hụt!' },
        { name: 'already cancelled slip', header: { maPhieuHaoHut: 'HH000007', trangThai: 'Đã hủy' }, message: 'Phiếu hao hụt đã được hủy hoặc không thể hủy!' }
    ]) {
        await t.test(scenario.name, async () => {
            capturedQueries.length = 0;
            cancellationScenario = { ...scenario, details: [], sourceHistory: [] };
            const result = await cancel('HH000007');
            assert.equal(result.statusCode, 400);
            assert.equal(result.body.success, false);
            assert.equal(result.body.message, scenario.message);
            assert.equal(capturedQueries.some((query) => query.includes('UPDATE NGUYENVATLIEU')), false);
            assert.equal(cancellationTransactions.at(-1).commits, 0);
            assert.equal(cancellationTransactions.at(-1).rollbacks, 1);
        });
    }
});

test('PATCH /api/losses/:id/cancel rolls back if SQL does not confirm the requested ID and cancelled state', async () => {
    capturedQueries.length = 0;
    cancellationScenario = {
        header: { maPhieuHaoHut: 'HH00000', trangThai: 'Hoàn thành' },
        details: [{ maNVL: 'NVL0001', soLuong: 2 }],
        sourceHistory: [{ maNVL: 'NVL0001', maLichSuGoc: 11 }],
        updatedHeader: { maPhieuHaoHut: 'HH00000', trangThai: 'Đã hủy' }
    };
    const result = await cancel('HH000007');
    assert.equal(result.statusCode, 400);
    assert.equal(result.body.success, false);
    assert.match(result.body.message, /không khớp/i);
    assert.equal(capturedQueries.some((query) => query.includes('UPDATE NGUYENVATLIEU')), false);
    assert.equal(cancellationTransactions.at(-1).commits, 0);
    assert.equal(cancellationTransactions.at(-1).rollbacks, 1);
});

test('POST /api/losses accepts every frontend reason and binds it as Unicode', async () => {
    const frontendSource = fs.readFileSync(path.join(__dirname, '../../src/data.js'), 'utf8');
    const reasonList = frontendSource.match(/LOSS_REASONS\s*=\s*\[([^\]]+)\]/)?.[1];
    assert.ok(reasonList, 'Frontend LOSS_REASONS list must exist.');
    const frontendReasons = [...reasonList.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    assert.deepEqual(frontendReasons, ['Đổ vỡ/rơi vãi', 'Hư hỏng', 'Hết hạn', 'Chế biến dư', 'Khác']);

    for (const reason of frontendReasons) {
        capturedInputs.length = 0;
        const result = await post({
            ngayHaoHut: '2026-11-14',
            lyDo: reason,
            ghiChu: reason === 'Khác' ? 'Ghi chú thử' : null,
            chiTiet: [{ maNVL: 'NVL0001', soLuong: 1.5 }]
        });

        assert.equal(result.statusCode, 201, `Frontend reason was rejected: ${reason}`);
        assert.equal(result.body.success, true);
        assert.equal(result.body.data.maPhieuHaoHut, 'HH00001');
        assert.deepEqual(capturedInputs.find((input) => input.name === 'lyDo'), {
            name: 'lyDo',
            type: 'nvarchar(200)',
            value: reason
        });
    }
});

test('POST /api/losses keeps exact reason validation', async () => {
    const result = await post({
        ngayHaoHut: '2026-11-14',
        lyDo: 'Hư hỏng ',
        chiTiet: [{ maNVL: 'NVL0001', soLuong: 1 }]
    });

    assert.equal(result.statusCode, 400);
    assert.equal(result.body.message, 'Lý do hao hụt không hợp lệ!');
});
