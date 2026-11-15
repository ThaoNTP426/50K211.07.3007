'use strict';

const express = require('express');
const router = express.Router();
const sql = require('mssql/msnodesqlv8');
const { poolPromise } = require('../config/database');
const { decimalToUnits, unitsToNumber } = require('../utils/decimal4');
const { insertInventoryHistory } = require('../utils/inventoryHistoryInstrumentation');

router.post('/', async (req, res) => {
    const { maNVL, tonMoi, lyDo, ghiChu, requestId } = req.body || {};

    if (
        typeof maNVL !== 'string' ||
        !/^NVL\d{4}$/.test(maNVL.trim()) ||
        typeof lyDo !== 'string' ||
        !lyDo.trim() ||
        (ghiChu != null && typeof ghiChu !== 'string') ||
        String(ghiChu || '').length > 500 ||
        typeof requestId !== 'string' ||
        !/^[A-Za-z0-9_-]{12,20}$/.test(requestId)
    ) {
        return res.status(400).json({
            success: false,
            message: 'Dữ liệu điều chỉnh tồn kho không hợp lệ!'
        });
    }

    let tonMoiDonVi;
    try {
        tonMoiDonVi = decimalToUnits(tonMoi);
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }

    if (tonMoiDonVi < 0n || tonMoiDonVi > decimalToUnits('9999999999.9999')) {
        return res.status(400).json({
            success: false,
            message: 'Tồn mới phải không âm và nằm trong giới hạn DECIMAL(14,4)!'
        });
    }

    let transaction;
    try {
        const pool = await poolPromise;
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        const requestLock = new sql.Request(transaction);
        requestLock.input('resource', sql.NVarChar(255), `doi-coffee:stock-adjust:${requestId}`);
        const lockResult = await requestLock.query(`
            DECLARE @lockResult INT;
            EXEC @lockResult = sys.sp_getapplock
                @Resource = @resource,
                @LockMode = 'Exclusive',
                @LockOwner = 'Transaction',
                @LockTimeout = 10000;
            SELECT @lockResult AS lockResult;
        `);

        if (lockResult.recordset[0].lockResult < 0) {
            throw new Error('Khong the khoa yeu cau dieu chinh de chong ghi lap!');
        }

        const requestExisting = new sql.Request(transaction);
        requestExisting.input('requestId', sql.VarChar(20), requestId);
        const existing = await requestExisting.query(`
            SELECT TOP (1)
                maLichSu, maNVL, soLuongThayDoi, tonTruoc, tonSau,
                thoiGian, maThamChieu, ghiChu
            FROM dbo.LICHSUTONKHO WITH (UPDLOCK, HOLDLOCK)
            WHERE nguonTacDong = N'Điều chỉnh tồn kho'
              AND maThamChieu = @requestId
              AND thoiGianXoa IS NULL
        `);

        if (existing.recordset.length) {
            const replay = existing.recordset[0];
            if (
                String(replay.maNVL).trim() !== maNVL.trim() ||
                decimalToUnits(replay.tonSau) !== tonMoiDonVi
            ) {
                const error = new Error('requestId đã được dùng cho một nội dung điều chỉnh khác.');
                error.statusCode = 409;
                throw error;
            }
            await transaction.commit();
            return res.status(200).json({
                success: true,
                replayed: true,
                data: replay
            });
        }

        const requestStock = new sql.Request(transaction);
        requestStock.input('maNVL', sql.Char(7), maNVL.trim());
        const stock = await requestStock.query(`
            SELECT tonHienTai
            FROM dbo.NGUYENVATLIEU WITH (UPDLOCK, ROWLOCK)
            WHERE maNVL = @maNVL
              AND trangThaiXoa = 0
        `);

        if (!stock.recordset.length) {
            const error = new Error('Khong tim thay nguyen vat lieu dang hoat dong!');
            error.statusCode = 404;
            throw error;
        }

        const tonTruocDonVi = decimalToUnits(stock.recordset[0].tonHienTai);
        const deltaDonVi = tonMoiDonVi - tonTruocDonVi;
        if (deltaDonVi === 0n) {
            const error = new Error('Ton moi bang ton hien tai, khong co thay doi!');
            error.statusCode = 400;
            throw error;
        }

        const tonTruoc = unitsToNumber(tonTruocDonVi);
        const tonSau = unitsToNumber(tonMoiDonVi);
        const delta = unitsToNumber(deltaDonVi);

        const requestUpdate = new sql.Request(transaction);
        requestUpdate.input('maNVL', sql.Char(7), maNVL.trim());
        requestUpdate.input('tonSau', sql.Decimal(14, 4), tonSau);
        requestUpdate.input('tonTruoc', sql.Decimal(14, 4), tonTruoc);
        const updated = await requestUpdate.query(`
            UPDATE dbo.NGUYENVATLIEU
            SET tonHienTai = @tonSau
            OUTPUT deleted.tonHienTai AS tonTruoc,
                   inserted.tonHienTai AS tonSau
            WHERE maNVL = @maNVL
              AND trangThaiXoa = 0
              AND tonHienTai = @tonTruoc
        `);

        if (!updated.recordset.length) {
            throw new Error('Ton kho da thay doi dong thoi; vui long tai lai va thu lai!');
        }

        const requestHistory = new sql.Request(transaction);
        requestHistory.input('maNVL', sql.Char(7), maNVL.trim());
        requestHistory.input('delta', sql.Decimal(14, 4), delta);
        requestHistory.input('tonTruoc', sql.Decimal(14, 4), Number(updated.recordset[0].tonTruoc));
        requestHistory.input('tonSau', sql.Decimal(14, 4), Number(updated.recordset[0].tonSau));
        requestHistory.input('requestId', sql.VarChar(20), requestId);
        requestHistory.input('ghiChu', sql.NVarChar(500), `${lyDo.trim()}${ghiChu?.trim() ? `: ${ghiChu.trim()}` : ''}`);
        const movementType = 'Điều chỉnh';
        requestHistory.input('loaiBienDong', sql.NVarChar(30), movementType);
        const history = await insertInventoryHistory(requestHistory, `
            INSERT INTO dbo.LICHSUTONKHO (
                maNVL, loaiBienDong, nguonTacDong,
                soLuongThayDoi, tonTruoc, tonSau,
                maThamChieu, ghiChu
            )
            OUTPUT INSERTED.maLichSu, INSERTED.thoiGian,
                   INSERTED.maNVL, INSERTED.soLuongThayDoi,
                   INSERTED.tonTruoc, INSERTED.tonSau,
                   INSERTED.maThamChieu, INSERTED.ghiChu
            VALUES (
                @maNVL, @loaiBienDong, N'Điều chỉnh tồn kho',
                @delta, @tonTruoc, @tonSau,
                @requestId, @ghiChu
            );
        `, {
            api: `${req.method} ${req.originalUrl}`,
            operation: 'inventory-adjustment.create',
            maPhieu: requestId,
            maThamChieu: requestId,
            maNVL: maNVL.trim(),
            loaiBienDong: movementType,
            soLuongThayDoi: delta,
            tonTruoc: Number(updated.recordset[0].tonTruoc),
            tonSau: Number(updated.recordset[0].tonSau)
        });

        await transaction.commit();
        return res.status(201).json({
            success: true,
            replayed: false,
            data: history.recordset[0]
        });
    } catch (error) {
        if (transaction) {
            try { await transaction.rollback(); } catch {}
        }
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || 'Không thể điều chỉnh tồn kho!'
        });
    }
});

module.exports = router;
