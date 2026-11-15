
'use strict';

const express = require('express');
const router = express.Router();
const sql = require('mssql/msnodesqlv8');

const { poolPromise } = require('../config/database');
const { decimalToUnits, unitsToNumber } = require('../utils/decimal4');
const { insertInventoryHistory } = require('../utils/inventoryHistoryInstrumentation');

const SOURCE = 'Máy POS';
const MOVEMENT_TYPE = 'Bán hàng (POS)';

// Chia số nguyên BigInt và làm tròn đến đơn vị gần nhất.
function divideRounded(numerator, denominator) {
    if (denominator <= 0n) {
        throw new Error('Tỷ lệ quy đổi phải lớn hơn 0.');
    }

    return (numerator + denominator / 2n) / denominator;
}

// Đọc danh sách món đang kinh doanh cùng công thức.
router.get('/menu', async (req, res) => {
    try {
        const pool = await poolPromise;

        const result = await pool.request().query(`
            SELECT
                m.maMon,
                m.tenMon,
                m.nhomMon,
                m.loaiCongThuc,
                m.donViTinh,
                c.maNVL,
                c.dinhLuong,
                n.tenNVL,
                n.donViTinh AS donViTonKho,
                n.donViQuyDoi,
                n.tyLeQuyDoi
            FROM dbo.MON AS m
            INNER JOIN dbo.CONGTHUCMON AS c
                ON c.maMon = m.maMon
            INNER JOIN dbo.NGUYENVATLIEU AS n
                ON n.maNVL = c.maNVL
            WHERE m.trangThai = N'Đang kinh doanh'
              AND n.trangThaiXoa = 0
            ORDER BY m.loaiCongThuc, m.tenMon, n.tenNVL;
        `);

        const menuMap = new Map();

        for (const row of result.recordset) {
            const maMon = String(row.maMon).trim();

            if (!menuMap.has(maMon)) {
                menuMap.set(maMon, {
                    maMon,
                    tenMon: row.tenMon,
                    nhomMon: row.nhomMon,
                    loaiCongThuc: row.loaiCongThuc,
                    donViTinh: row.donViTinh,
                    ingredients: []
                });
            }

            menuMap.get(maMon).ingredients.push({
                maNVL: String(row.maNVL).trim(),
                tenNVL: row.tenNVL,
                dinhLuong: Number(row.dinhLuong),
                donViCongThuc: row.donViQuyDoi || row.donViTonKho,
                donViTonKho: row.donViTonKho,
                donViQuyDoi: row.donViQuyDoi,
                tyLeQuyDoi: row.tyLeQuyDoi == null
                    ? null
                    : Number(row.tyLeQuyDoi)
            });
        }

        const menu = Array.from(menuMap.values());

        return res.json({
            success: true,
            data: {
                monChinh: menu.filter(item => item.loaiCongThuc === 'Món chính'),
                extras: menu.filter(item => item.loaiCongThuc === 'Extra')
            }
        });
    } catch (error) {
        console.error('POS menu error:', error);

        return res.status(500).json({
            success: false,
            message: 'Không thể lấy danh sách món POS.'
        });
    }
});

// Thanh toán hóa đơn và trừ nguyên vật liệu.
router.post('/checkout', async (req, res) => {
    const { maHoaDon, trangThai, thoiGian, items } = req.body || {};

    if (
        typeof maHoaDon !== 'string' ||
        !/^[A-Za-z0-9_-]{1,20}$/.test(maHoaDon) ||
        trangThai !== 'Đã thanh toán' ||
        !Array.isArray(items) ||
        items.length === 0
    ) {
        return res.status(400).json({
            success: false,
            message: 'Thông tin hóa đơn hoặc trạng thái thanh toán không hợp lệ.'
        });
    }

    if (
        thoiGian != null &&
        (typeof thoiGian !== 'string' || !Number.isFinite(Date.parse(thoiGian)))
    ) {
        return res.status(400).json({
            success: false,
            message: 'Thời gian hóa đơn không hợp lệ.'
        });
    }

    // Kiểm tra cấu trúc món chính và Extra.
    for (const item of items) {
        if (
            !item ||
            typeof item.maMon !== 'string' ||
            !/^MON\d{4}$/.test(item.maMon.trim()) ||
            !Number.isSafeInteger(item.soLuong) ||
            item.soLuong <= 0 ||
            !Array.isArray(item.extras || [])
        ) {
            return res.status(400).json({
                success: false,
                message: 'Chi tiết món trong hóa đơn không hợp lệ.'
            });
        }

        for (const extra of (item.extras || [])) {
            if (
                !extra ||
                typeof extra.maMon !== 'string' ||
                !/^MON\d{4}$/.test(extra.maMon.trim()) ||
                !Number.isSafeInteger(extra.soLuong) ||
                extra.soLuong <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'Thông tin Extra không hợp lệ.'
                });
            }
        }
    }

    let transaction;

    try {
        const pool = await poolPromise;
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        // Khóa theo mã hóa đơn để chống hai yêu cầu cùng thanh toán.
        const lockRequest = new sql.Request(transaction);
        lockRequest.input(
            'resource',
            sql.NVarChar(255),
            `doi-coffee:pos:${maHoaDon}`
        );

        const lockResult = await lockRequest.query(`
            DECLARE @lockResult INT;

            EXEC @lockResult = sys.sp_getapplock
                @Resource = @resource,
                @LockMode = 'Exclusive',
                @LockOwner = 'Transaction',
                @LockTimeout = 10000;

            SELECT @lockResult AS lockResult;
        `);

        if (lockResult.recordset[0].lockResult < 0) {
            const error = new Error('Không thể khóa hóa đơn để chống xử lý trùng.');
            error.statusCode = 409;
            throw error;
        }

        // Nếu hóa đơn đã được ghi lịch sử POS, không trừ kho lần nữa.
        const existingRequest = new sql.Request(transaction);
        existingRequest.input('maHoaDon', sql.VarChar(20), maHoaDon);

        const existing = await existingRequest.query(`
            SELECT TOP (1) maLichSu
            FROM dbo.LICHSUTONKHO WITH (UPDLOCK, HOLDLOCK)
            WHERE nguonTacDong = N'Máy POS'
              AND maThamChieu = @maHoaDon;
        `);

        if (existing.recordset.length > 0) {
            await transaction.commit();

            return res.status(200).json({
                success: true,
                replayed: true,
                message: 'Hóa đơn đã được xử lý trước đó. Không trừ kho lần nữa.'
            });
        }

        // Lấy công thức thực tế từ database.
        const recipeResult = await new sql.Request(transaction).query(`
            SELECT
                m.maMon,
                m.tenMon,
                m.loaiCongThuc,
                m.trangThai,
                c.maNVL,
                c.dinhLuong,
                n.tenNVL,
                n.donViTinh,
                n.donViQuyDoi,
                n.tyLeQuyDoi,
                n.trangThaiXoa
            FROM dbo.MON AS m
            INNER JOIN dbo.CONGTHUCMON AS c
                ON c.maMon = m.maMon
            INNER JOIN dbo.NGUYENVATLIEU AS n
                ON n.maNVL = c.maNVL;
        `);

        const recipeMap = new Map();

        for (const row of recipeResult.recordset) {
            const maMon = String(row.maMon).trim();

            if (!recipeMap.has(maMon)) {
                recipeMap.set(maMon, {
                    maMon,
                    tenMon: row.tenMon,
                    loaiCongThuc: row.loaiCongThuc,
                    trangThai: row.trangThai,
                    ingredients: []
                });
            }

            recipeMap.get(maMon).ingredients.push(row);
        }

        // Tổng hợp lượng nguyên vật liệu cần trừ.
        // Dùng BigInt để tránh sai số khi cộng số thập phân.
        const requiredStock = new Map();

        function addRecipe(maMon, multiplier) {
            const recipe = recipeMap.get(maMon);

            if (
                !recipe ||
                recipe.trangThai !== 'Đang kinh doanh' ||
                recipe.ingredients.length === 0
            ) {
                const error = new Error(`Món ${maMon} không có công thức hợp lệ hoặc không còn kinh doanh.`);
                error.statusCode = 400;
                throw error;
            }

            for (const ingredient of recipe.ingredients) {
                if (ingredient.trangThaiXoa) {
                    const error = new Error(`Nguyên vật liệu ${ingredient.tenNVL} đã ngừng sử dụng.`);
                    error.statusCode = 409;
                    throw error;
                }

                const maNVL = String(ingredient.maNVL).trim();
                const recipeQty = decimalToUnits(ingredient.dinhLuong) *
                    BigInt(multiplier);

                let stockQty = recipeQty;

                // Công thức dùng đơn vị quy đổi thì đổi về đơn vị tồn kho.
                if (ingredient.donViQuyDoi) {
                    if (
                        ingredient.tyLeQuyDoi == null ||
                        Number(ingredient.tyLeQuyDoi) <= 0
                    ) {
                        throw new Error(`Nguyên vật liệu ${ingredient.tenNVL} thiếu tỷ lệ quy đổi.`);
                    }

                    const ratio = decimalToUnits(ingredient.tyLeQuyDoi);
                    stockQty = divideRounded(
                        recipeQty * 10000n,
                        ratio
                    );
                }

                if (stockQty <= 0n) {
                    throw new Error(`Số lượng nguyên vật liệu ${ingredient.tenNVL} không hợp lệ.`);
                }

                if (!requiredStock.has(maNVL)) {
                    requiredStock.set(maNVL, {
                        maNVL,
                        tenNVL: ingredient.tenNVL,
                        quantity: 0n
                    });
                }

                requiredStock.get(maNVL).quantity += stockQty;
            }
        }

        for (const item of items) {
            const maMon = item.maMon.trim();
            const mainRecipe = recipeMap.get(maMon);

            if (!mainRecipe || mainRecipe.loaiCongThuc !== 'Món chính') {
                const error = new Error(`${maMon} không phải món chính hợp lệ.`);
                error.statusCode = 400;
                throw error;
            }

            addRecipe(maMon, item.soLuong);

            // Số lượng Extra là số phần Extra cho MỖI món chính.
            for (const extra of (item.extras || [])) {
                const extraCode = extra.maMon.trim();
                const extraRecipe = recipeMap.get(extraCode);

                if (!extraRecipe || extraRecipe.loaiCongThuc !== 'Extra') {
                    const error = new Error(`${extraCode} không phải Extra hợp lệ.`);
                    error.statusCode = 400;
                    throw error;
                }

                addRecipe(extraCode, item.soLuong * extra.soLuong);
            }
        }

        // Khóa và cập nhật từng nguyên vật liệu theo thứ tự mã.
        const materials = Array.from(requiredStock.values())
            .sort((a, b) => a.maNVL.localeCompare(b.maNVL));

        const deductions = [];

        for (const material of materials) {
            const stockRequest = new sql.Request(transaction);
            stockRequest.input('maNVL', sql.Char(7), material.maNVL);

            const stockResult = await stockRequest.query(`
                SELECT tonHienTai
                FROM dbo.NGUYENVATLIEU WITH (UPDLOCK, ROWLOCK)
                WHERE maNVL = @maNVL
                  AND trangThaiXoa = 0;
            `);

            if (!stockResult.recordset.length) {
                const error = new Error(`Không tìm thấy nguyên vật liệu ${material.tenNVL} đang hoạt động.`);
                error.statusCode = 409;
                throw error;
            }

            const beforeUnits = decimalToUnits(stockResult.recordset[0].tonHienTai);
            const afterUnits = beforeUnits - material.quantity;

            if (afterUnits < 0n) {
                const error = new Error(
                    `Không đủ tồn kho ${material.tenNVL}. Cần ${unitsToNumber(material.quantity)}, hiện có ${unitsToNumber(beforeUnits)}.`
                );
                error.statusCode = 409;
                throw error;
            }

            deductions.push({
                ...material,
                before: unitsToNumber(beforeUnits),
                after: unitsToNumber(afterUnits),
                delta: unitsToNumber(-material.quantity)
            });
        }

        // Chỉ bắt đầu cập nhật sau khi đã kiểm tra đủ tất cả nguyên liệu.
        for (const deduction of deductions) {
            const updateRequest = new sql.Request(transaction);

            updateRequest.input('maNVL', sql.Char(7), deduction.maNVL);
            updateRequest.input('before', sql.Decimal(14, 4), deduction.before);
            updateRequest.input('after', sql.Decimal(14, 4), deduction.after);

            const updated = await updateRequest.query(`
                UPDATE dbo.NGUYENVATLIEU
                SET tonHienTai = @after
                WHERE maNVL = @maNVL
                  AND trangThaiXoa = 0
                  AND tonHienTai = @before;

                SELECT @@ROWCOUNT AS affectedRows;
            `);

            if (!updated.recordset[0]?.affectedRows) {
                throw new Error(`Tồn kho ${deduction.tenNVL} vừa thay đổi. Vui lòng thử lại.`);
            }

            const historyRequest = new sql.Request(transaction);

            historyRequest.input('maNVL', sql.Char(7), deduction.maNVL);
            historyRequest.input('delta', sql.Decimal(14, 4), deduction.delta);
            historyRequest.input('before', sql.Decimal(14, 4), deduction.before);
            historyRequest.input('after', sql.Decimal(14, 4), deduction.after);
            historyRequest.input('maHoaDon', sql.VarChar(20), maHoaDon);

            const note = `Bán hàng POS - Hóa đơn ${maHoaDon}` +
                (thoiGian ? ` - Thời gian hóa đơn: ${thoiGian}` : '');

            historyRequest.input('note', sql.NVarChar(500), note);

            await insertInventoryHistory(
                historyRequest,
                `
                    INSERT INTO dbo.LICHSUTONKHO (
                        maNVL,
                        loaiBienDong,
                        nguonTacDong,
                        soLuongThayDoi,
                        tonTruoc,
                        tonSau,
                        maThamChieu,
                        ghiChu,
                        trangThai
                    )
                    VALUES (
                        @maNVL,
                        N'Bán hàng (POS)',
                        N'Máy POS',
                        @delta,
                        @before,
                        @after,
                        @maHoaDon,
                        @note,
                        N'Hợp lệ'
                    );
                `,
                {
                    api: `${req.method} ${req.originalUrl}`,
                    operation: 'pos.checkout',
                    maPhieu: maHoaDon,
                    maThamChieu: maHoaDon,
                    maNVL: deduction.maNVL,
                    loaiBienDong: MOVEMENT_TYPE,
                    soLuongThayDoi: deduction.delta,
                    tonTruoc: deduction.before,
                    tonSau: deduction.after
                }
            );
        }

        await transaction.commit();

        return res.status(201).json({
            success: true,
            replayed: false,
            message: 'Thanh toán thành công và đã cập nhật tồn kho.',
            data: {
                maHoaDon,
                soNguyenVatLieuDaTru: deductions.length,
                deductions: deductions.map(item => ({
                    maNVL: item.maNVL,
                    tenNVL: item.tenNVL,
                    soLuongDaTru: -item.delta,
                    tonSau: item.after
                }))
            }
        });
    } catch (error) {
        if (transaction) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('POS rollback error:', rollbackError);
            }
        }

        console.error('POS checkout error:', error);

        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || 'Không thể xử lý thanh toán POS.'
        });
    }
});

module.exports = router;
