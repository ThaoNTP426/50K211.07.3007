const express = require('express');
const router = express.Router();

const { poolPromise } = require('../config/database');
const sql = require('mssql/msnodesqlv8');
const { decimalToUnits, unitsToNumber } = require('../utils/decimal4');
const { calculateStockTransition } = require('../utils/stockTransition');
const { insertInventoryHistory } = require('../utils/inventoryHistoryInstrumentation');
const DOCUMENT_MANAGED_SOURCES = new Set([
    'Thêm phiếu nhập kho',
    'Phiếu nhập kho',
    'Phiếu hao hụt',
    'Tạo phiếu hao hụt',
    'Hủy phiếu hao hụt',
    'Máy POS'
]);

// API: Lấy lịch sử biến động tồn kho còn hiệu lực lưu trữ.
router.get('/', async (req, res) => {
    try {
        const pool = await poolPromise;

        const includeDeleted = req.query.includeDeleted === 'true';
        if (req.query.includeDeleted && !['true', 'false'].includes(req.query.includeDeleted)) {
            return res.status(400).json({ success: false, message: 'includeDeleted phải là true hoặc false.' });
        }
        const result = await pool.request()
            .input('includeDeleted', sql.Bit, includeDeleted)
            .query(`
            SELECT
                ls.maLichSu,
                ls.maNVL,
                nvl.tenNVL,
                nvl.donViTinh,
                ls.loaiBienDong,
                ls.nguonTacDong,
                ls.soLuongThayDoi,
                ls.tonTruoc,
                ls.tonSau,
                ls.thoiGian,
                ls.maThamChieu,
                ls.ghiChu,
                ls.trangThai,
                ls.thoiGianXoa,
                ls.nguoiXoa,
                ls.maLichSuGoc
            FROM dbo.LICHSUTONKHO AS ls
            INNER JOIN dbo.NGUYENVATLIEU AS nvl
                ON nvl.maNVL = ls.maNVL
            WHERE @includeDeleted = 1 OR ls.thoiGianXoa IS NULL
            ORDER BY ls.thoiGian DESC, ls.maLichSu DESC;
        `);

        return res.status(200).json({
            success: true,
            total: result.recordset.length,
            data: result.recordset
        });
    } catch (error) {
        console.error('Lỗi lấy lịch sử tồn kho:', error.message);

        return res.status(500).json({
            success: false,
            message: 'Không thể lấy lịch sử tồn kho!',
            error: error.message
        });
    }
});

router.delete('/:id', async (req, res) => {
    if (!/^\d{1,19}$/.test(req.params.id)) {
        return res.status(400).json({ success: false, message: 'Mã lịch sử không hợp lệ.' });
    }
    let transaction;
    try {
        const pool = await poolPromise;
        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const history = await new sql.Request(transaction)
            .input('id', sql.BigInt, req.params.id)
            .query(`SELECT maLichSu, maNVL, soLuongThayDoi, loaiBienDong, nguonTacDong,
                           maThamChieu, ghiChu, thoiGianXoa, maLichSuGoc
                    FROM dbo.LICHSUTONKHO WITH (UPDLOCK, HOLDLOCK)
                    WHERE maLichSu = @id;`);
        const original = history.recordset[0];
        if (!original) throw Object.assign(new Error('Không tìm thấy lịch sử.'), { statusCode: 404 });
        if (original.maLichSuGoc != null) throw Object.assign(new Error('Không thể xóa bản ghi đảo tồn.'), { statusCode: 409 });
        if (DOCUMENT_MANAGED_SOURCES.has(String(original.nguonTacDong).trim())) {
            throw Object.assign(new Error('Lịch sử này thuộc phiếu nghiệp vụ/POS; hãy xử lý qua nghiệp vụ nguồn.'), { statusCode: 409 });
        }
        if (original.thoiGianXoa) {
            await transaction.commit();
            return res.json({ success: true, replayed: true, message: 'Bản ghi đã ở trong thùng rác.' });
        }

        const beforeResult = await new sql.Request(transaction)
            .input('maNVL', sql.Char(7), original.maNVL)
            .query('SELECT tonHienTai FROM dbo.NGUYENVATLIEU WITH (UPDLOCK, ROWLOCK) WHERE maNVL = @maNVL AND trangThaiXoa = 0;');
        if (!beforeResult.recordset.length) throw Object.assign(new Error('Không tìm thấy nguyên vật liệu đang hoạt động.'), { statusCode: 409 });
        let transition;
        try {
            transition = calculateStockTransition(beforeResult.recordset[0].tonHienTai, unitsToNumber(-decimalToUnits(original.soLuongThayDoi)));
        } catch (error) {
            throw Object.assign(new Error('Không thể xóa vì đảo giao dịch sẽ làm tồn kho âm.'), { statusCode: 409 });
        }
        const { before, delta, after } = transition;

        await new sql.Request(transaction)
            .input('maNVL', sql.Char(7), original.maNVL)
            .input('stock', sql.Decimal(14, 4), after)
            .query('UPDATE dbo.NGUYENVATLIEU SET tonHienTai = @stock WHERE maNVL = @maNVL AND trangThaiXoa = 0;');

        const movementType = 'Điều chỉnh';
        const inverseRequest = new sql.Request(transaction)
            .input('maNVL', sql.Char(7), original.maNVL)
            .input('delta', sql.Decimal(14, 4), delta)
            .input('before', sql.Decimal(14, 4), before)
            .input('after', sql.Decimal(14, 4), after)
            .input('reference', sql.VarChar(20), original.maThamChieu)
            .input('note', sql.NVarChar(1000), `Đảo tồn lịch sử ${String(original.maLichSu)} khi chuyển vào thùng rác`)
            .input('movementType', sql.NVarChar(30), movementType)
            .input('originalId', sql.BigInt, req.params.id)
        const inverse = await insertInventoryHistory(inverseRequest, `INSERT dbo.LICHSUTONKHO
                        (maNVL, loaiBienDong, nguonTacDong, soLuongThayDoi, tonTruoc, tonSau, maThamChieu, ghiChu, trangThai, maLichSuGoc)
                    OUTPUT INSERTED.maLichSu
                    VALUES (@maNVL, @movementType, N'Đảo giao dịch', @delta, @before, @after, @reference, @note, N'Hợp lệ', @originalId);`, {
            api: `${req.method} ${req.originalUrl}`,
            operation: 'inventory-history.delete',
            maPhieu: original.maThamChieu,
            maThamChieu: original.maThamChieu,
            maNVL: original.maNVL,
            loaiBienDong: movementType,
            soLuongThayDoi: delta,
            tonTruoc: before,
            tonSau: after
        });

        const marked = await new sql.Request(transaction)
            .input('id', sql.BigInt, req.params.id)
            .input('account', sql.Char(7), req.auth.maTK)
            .query('UPDATE dbo.LICHSUTONKHO SET thoiGianXoa = GETDATE(), nguoiXoa = @account WHERE maLichSu = @id AND thoiGianXoa IS NULL; SELECT @@ROWCOUNT AS affectedRows;');
        if (!marked.recordset[0]?.affectedRows) throw new Error('Lịch sử vừa được cập nhật đồng thời; hãy tải lại.');
        await transaction.commit();
        return res.json({ success: true, data: { maLichSu: req.params.id, maLichSuDaoTon: String(inverse.recordset[0].maLichSu) } });
    } catch (error) {
        if (transaction) try { await transaction.rollback(); } catch {}
        return res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Không thể chuyển lịch sử vào thùng rác.' });
    }
});

router.patch('/:id/restore', async (req, res) => {
    if (!/^\d{1,19}$/.test(req.params.id)) {
        return res.status(400).json({ success: false, message: 'Mã lịch sử không hợp lệ.' });
    }
    let transaction;
    try {
        const pool = await poolPromise;
        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const found = await new sql.Request(transaction)
            .input('id', sql.BigInt, req.params.id)
            .query(`SELECT maLichSu, maNVL, soLuongThayDoi, maThamChieu, thoiGianXoa, maLichSuGoc
                    FROM dbo.LICHSUTONKHO WITH (UPDLOCK, HOLDLOCK) WHERE maLichSu = @id;`);
        const original = found.recordset[0];
        if (!original) throw Object.assign(new Error('Không tìm thấy lịch sử.'), { statusCode: 404 });
        if (!original.thoiGianXoa) {
            await transaction.commit();
            return res.json({ success: true, replayed: true, message: 'Bản ghi đã được khôi phục.' });
        }
        if (original.maLichSuGoc != null) throw Object.assign(new Error('Không thể khôi phục một bản ghi đảo tồn.'), { statusCode: 409 });
        if (DOCUMENT_MANAGED_SOURCES.has(String(original.nguonTacDong).trim())) {
            throw Object.assign(new Error('Lịch sử này thuộc phiếu nghiệp vụ/POS; không thể khôi phục độc lập.'), { statusCode: 409 });
        }

        const current = await new sql.Request(transaction)
            .input('maNVL', sql.Char(7), original.maNVL)
            .query('SELECT tonHienTai FROM dbo.NGUYENVATLIEU WITH (UPDLOCK, ROWLOCK) WHERE maNVL = @maNVL AND trangThaiXoa = 0;');
        if (!current.recordset.length) throw Object.assign(new Error('Không tìm thấy nguyên vật liệu đang hoạt động.'), { statusCode: 409 });
        let transition;
        try {
            transition = calculateStockTransition(current.recordset[0].tonHienTai, original.soLuongThayDoi);
        } catch (error) {
            throw Object.assign(new Error('Không thể khôi phục vì tồn kho sẽ âm.'), { statusCode: 409 });
        }
        const { before, delta, after } = transition;

        await new sql.Request(transaction)
            .input('maNVL', sql.Char(7), original.maNVL)
            .input('stock', sql.Decimal(14, 4), after)
            .query('UPDATE dbo.NGUYENVATLIEU SET tonHienTai = @stock WHERE maNVL = @maNVL AND trangThaiXoa = 0;');
        const movementType = 'Điều chỉnh';
        const restoredRequest = new sql.Request(transaction)
            .input('maNVL', sql.Char(7), original.maNVL)
            .input('delta', sql.Decimal(14, 4), delta)
            .input('before', sql.Decimal(14, 4), before)
            .input('after', sql.Decimal(14, 4), after)
            .input('reference', sql.VarChar(20), original.maThamChieu)
            .input('note', sql.NVarChar(1000), `Khôi phục lịch sử ${String(original.maLichSu)}`)
            .input('movementType', sql.NVarChar(30), movementType)
            .input('originalId', sql.BigInt, req.params.id)
        const restored = await insertInventoryHistory(restoredRequest, `INSERT dbo.LICHSUTONKHO
                        (maNVL, loaiBienDong, nguonTacDong, soLuongThayDoi, tonTruoc, tonSau, maThamChieu, ghiChu, trangThai, maLichSuGoc)
                    OUTPUT INSERTED.maLichSu
                    VALUES (@maNVL, @movementType, N'Khôi phục giao dịch', @delta, @before, @after, @reference, @note, N'Hợp lệ', @originalId);`, {
            api: `${req.method} ${req.originalUrl}`,
            operation: 'inventory-history.restore',
            maPhieu: original.maThamChieu,
            maThamChieu: original.maThamChieu,
            maNVL: original.maNVL,
            loaiBienDong: movementType,
            soLuongThayDoi: delta,
            tonTruoc: before,
            tonSau: after
        });
        const cleared = await new sql.Request(transaction)
            .input('id', sql.BigInt, req.params.id)
            .query('UPDATE dbo.LICHSUTONKHO SET thoiGianXoa = NULL, nguoiXoa = NULL WHERE maLichSu = @id AND thoiGianXoa IS NOT NULL; SELECT @@ROWCOUNT AS affectedRows;');
        if (!cleared.recordset[0]?.affectedRows) throw new Error('Lịch sử vừa được cập nhật đồng thời; hãy tải lại.');
        await transaction.commit();
        return res.json({ success: true, data: { maLichSu: req.params.id, maLichSuKhoiPhuc: String(restored.recordset[0].maLichSu) } });
    } catch (error) {
        if (transaction) try { await transaction.rollback(); } catch {}
        return res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Không thể khôi phục lịch sử.' });
    }
});

module.exports = router;
