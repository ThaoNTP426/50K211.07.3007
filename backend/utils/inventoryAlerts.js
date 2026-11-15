'use strict';

function buildAlertList(lowStock, outOfStock, expiry, longStock) {
    const alerts = [];
    for (const item of lowStock) alerts.push({ key: `LOW|${item.maNVL}`, type: 'lowStock', item });
    for (const item of outOfStock) alerts.push({ key: `OUT|${item.maNVL}`, type: 'outOfStock', item });
    for (const item of expiry) {
        const expiryDate = new Date(item.hanSuDung).toISOString().slice(0, 10);
        alerts.push({ key: `EXPIRY|${item.maNVL}|${item.maPhieuNhap}|${expiryDate}`, type: 'expiry', item });
    }
    for (const item of longStock) alerts.push({ key: `LONG|${item.maNVL}`, type: 'longStock', item });
    return alerts;
}

module.exports = { buildAlertList };
