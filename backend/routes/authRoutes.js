'use strict';

const express = require('express');
const { poolPromise, sql } = require('../config/database');
const { hashPassword, verifyPassword } = require('../utils/passwordHash');
const router = express.Router();

const crypto = require('crypto');
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const JWT_ISSUER = 'doi-coffee-api';
const revokedTokens = new Map();
const tokensByAccount = new Map();

function createToken(account) {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
        throw new Error('JWT_SECRET must be configured with at least 32 characters.');
    }
    const now = Math.floor(Date.now() / 1000);
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const jti = crypto.randomUUID();
    const input = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
        iss: JWT_ISSUER,
        sub: account.maTK,
        jti,
        maTK: account.maTK,
        tenDangNhap: account.tenDangNhap,
        vaiTro: account.vaiTro,
        iat: now,
        exp: now + SESSION_TTL_SECONDS
    })}`;
    const signature = crypto.createHmac('sha256', secret).update(input).digest('base64url');
    const token = `${input}.${signature}`;
    const accountTokens = tokensByAccount.get(account.maTK) || new Map();
    accountTokens.set(token, now + SESSION_TTL_SECONDS);
    tokensByAccount.set(account.maTK, accountTokens);
    return token;
}

function revokeAccountTokens(maTK) {
    const accountTokens = tokensByAccount.get(maTK);
    if (!accountTokens) return;
    for (const [token, expiresAt] of accountTokens) revokedTokens.set(token, expiresAt);
    tokensByAccount.delete(maTK);
}

function authenticate(req, res, next) {
    const token = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    const reject = () => res.status(401).json({
        success: false,
        code: 'AUTH_TOKEN_INVALID',
        message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'
    });
    if (!token) return reject();

    try {
        const secret = process.env.JWT_SECRET;
        if (!secret || secret.length < 32) throw new Error('JWT_SECRET is not configured.');
        const parts = token.split('.');
        if (parts.length !== 3) return reject();
        const [headerPart, payloadPart, signature] = parts;
        const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8'));
        if (header.alg !== 'HS256' || header.typ !== 'JWT') return reject();
        const expected = crypto.createHmac('sha256', secret)
            .update(`${headerPart}.${payloadPart}`).digest();
        const actual = Buffer.from(signature, 'base64url');
        if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return reject();

        const claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
        const now = Math.floor(Date.now() / 1000);
        if (claims.iss !== JWT_ISSUER || typeof claims.sub !== 'string' ||
            !Number.isInteger(claims.exp) || claims.exp <= now ||
            typeof claims.maTK !== 'string' || claims.sub !== claims.maTK ||
            typeof claims.jti !== 'string' || revokedTokens.has(token)) return reject();
        for (const [revokedToken, expiresAt] of revokedTokens) {
            if (expiresAt <= now) revokedTokens.delete(revokedToken);
        }
        req.auth = {
            maTK: claims.maTK,
            tenDangNhap: claims.tenDangNhap,
            vaiTro: claims.vaiTro
        };
        req.authToken = token;
        return next();
    } catch (error) {
        if (error.message === 'JWT_SECRET is not configured.') {
            console.error(error.message);
            return res.status(503).json({ success: false, message: 'Backend chưa được cấu hình JWT_SECRET.' });
        }
        return reject();
    }
}

router.post('/login', async (req, res) => {
    const tenDangNhap = typeof req.body?.tenDangNhap === 'string' ? req.body.tenDangNhap.trim() : '';
    const matKhau = typeof req.body?.matKhau === 'string' ? req.body.matKhau : '';
    if (!tenDangNhap || !matKhau || tenDangNhap.length > 100 || matKhau.length > 256) {
        return res.status(400).json({ success: false, message: 'Vui lòng nhập tên đăng nhập và mật khẩu hợp lệ.' });
    }

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('tenDangNhap', sql.NVarChar(100), tenDangNhap)
            .query(`
                SELECT maTK, tenDangNhap, matKhauHash, vaiTro, email
                FROM dbo.TAIKHOAN
                WHERE tenDangNhap = @tenDangNhap;
            `);
        const row = result.recordset[0];
        if (!row || !verifyPassword(matKhau, row.matKhauHash)) {
            return res.status(401).json({ success: false, message: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
        }

        const account = {
            maTK: String(row.maTK).trim(),
            tenDangNhap: row.tenDangNhap,
            vaiTro: row.vaiTro,
            email: row.email || ''
        };
        return res.status(200).json({ success: true, token: createToken(account), data: account });
    } catch (error) {
        console.error('Login database error:', error.message);
        return res.status(503).json({ success: false, message: 'Không thể xác thực với SQL Server.' });
    }
});

router.get('/profile', authenticate, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('maTK', sql.Char(7), req.auth.maTK)
            .query('SELECT maTK, tenDangNhap, vaiTro, email FROM dbo.TAIKHOAN WHERE maTK = @maTK;');
        const account = result.recordset[0];
        if (!account) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản.' });
        return res.json({ success: true, data: { maTK: String(account.maTK).trim(), tenDangNhap: account.tenDangNhap, vaiTro: account.vaiTro, email: account.email || '' } });
    } catch (error) {
        console.error('Profile lookup error:', error.message);
        return res.status(500).json({ success: false, message: 'Không thể tải thông tin tài khoản.' });
    }
});

router.put('/profile', authenticate, async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    if (email.length > 50 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
        return res.status(400).json({ success: false, message: 'Email không hợp lệ hoặc vượt quá 50 ký tự.' });
    }
    const currentPassword = req.body?.matKhauHienTai;
    const nextPassword = req.body?.matKhauMoi;
    const changingPassword = Boolean(currentPassword || nextPassword);
    if (changingPassword && (typeof currentPassword !== 'string' || typeof nextPassword !== 'string' || nextPassword.length < 8 || nextPassword.length > 256)) {
        return res.status(400).json({ success: false, message: 'Mật khẩu mới phải có từ 8 đến 256 ký tự và cần nhập mật khẩu hiện tại.' });
    }
    try {
        const pool = await poolPromise;
        const request = pool.request()
            .input('maTK', sql.Char(7), req.auth.maTK)
            .input('email', sql.VarChar(50), email || null)
            .input('changingPassword', sql.Bit, changingPassword)
            .input('currentHash', sql.Char(64), changingPassword ? hashPassword(currentPassword) : null)
            .input('nextHash', sql.Char(64), changingPassword ? hashPassword(nextPassword) : null);
        const result = await request.query(`
            UPDATE dbo.TAIKHOAN
            SET email = @email,
                matKhauHash = CASE WHEN @changingPassword = 1 THEN @nextHash ELSE matKhauHash END
            WHERE maTK = @maTK
              AND (@changingPassword = 0 OR matKhauHash = @currentHash);
            SELECT @@ROWCOUNT AS affectedRows;
            SELECT maTK, tenDangNhap, vaiTro, email FROM dbo.TAIKHOAN WHERE maTK = @maTK;
        `);
        if (!result.recordsets[0]?.[0]?.affectedRows) {
            return res.status(401).json({ success: false, message: 'Mật khẩu hiện tại không đúng.' });
        }
        const account = result.recordsets[1]?.[0];
        if (changingPassword) {
            revokeAccountTokens(req.auth.maTK);
        }
        return res.json({ success: true, data: { maTK: String(account.maTK).trim(), tenDangNhap: account.tenDangNhap, vaiTro: account.vaiTro, email: account.email || '' } });
    } catch (error) {
        console.error('Profile update error:', error.message);
        return res.status(500).json({ success: false, message: 'Không thể cập nhật thông tin tài khoản.' });
    }
});

router.put('/password', authenticate, async (req, res) => {
    const current = req.body?.matKhauHienTai;
    const next = req.body?.matKhauMoi;
    if (typeof current !== 'string' || typeof next !== 'string' || next.length < 8 || next.length > 256) {
        return res.status(400).json({ success: false, message: 'Mật khẩu mới phải có từ 8 đến 256 ký tự.' });
    }

    try {
        const pool = await poolPromise;
        const request = pool.request()
            .input('maTK', sql.Char(7), req.auth.maTK)
            .input('currentHash', sql.Char(64), hashPassword(current))
            .input('nextHash', sql.Char(64), hashPassword(next));
        const result = await request.query(`
            UPDATE dbo.TAIKHOAN
            SET matKhauHash = @nextHash
            WHERE maTK = @maTK AND matKhauHash = @currentHash;
            SELECT @@ROWCOUNT AS affectedRows;
        `);
        if (!result.recordset[0]?.affectedRows) {
            return res.status(401).json({ success: false, message: 'Mật khẩu hiện tại không đúng.' });
        }
        revokeAccountTokens(req.auth.maTK);
        return res.status(200).json({ success: true, message: 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.' });
    } catch (error) {
        console.error('Password update error:', error.message);
        return res.status(500).json({ success: false, message: 'Không thể cập nhật mật khẩu.' });
    }
});

router.post('/logout', authenticate, (req, res) => {
    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
    revokedTokens.set(req.authToken, expiresAt);
    const accountTokens = tokensByAccount.get(req.auth.maTK);
    accountTokens?.delete(req.authToken);
    if (accountTokens?.size === 0) tokensByAccount.delete(req.auth.maTK);
    return res.status(200).json({ success: true });
});

module.exports = { router, authenticate };
