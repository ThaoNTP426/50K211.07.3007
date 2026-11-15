'use strict';

function getSqlErrorNumber(error) {
    const candidates = [
        error,
        error?.originalError,
        error?.originalError?.info,
        ...(Array.isArray(error?.precedingErrors) ? error.precedingErrors : [])
    ];
    return candidates.find((candidate) => Number.isInteger(candidate?.number))?.number ?? null;
}

function describeMovementType(value) {
    const text = typeof value === 'string' ? value : String(value ?? '');
    return {
        value: value === undefined ? '<undefined>' : value,
        runtimeType: value === null ? 'null' : typeof value,
        codeUnitLength: text.length,
        characterLength: Array.from(text).length,
        unicodeCodePoints: Array.from(text, (character) =>
            `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`
        )
    };
}

async function insertInventoryHistory(request, query, context) {
    const movementType = describeMovementType(context.loaiBienDong);
    const details = {
        processId: process.pid,
        workingDirectory: process.cwd(),
        api: context.api || context.operation,
        operation: context.operation,
        maPhieu: context.maPhieu ?? context.maThamChieu ?? null,
        maThamChieu: context.maThamChieu ?? null,
        maLichSuGoc: context.maLichSuGoc ?? null,
        maNVL: context.maNVL ?? null,
        loaiBienDong: movementType,
        soLuongThayDoi: context.soLuongThayDoi ?? null,
        tonTruoc: context.tonTruoc ?? null,
        tonSau: context.tonSau ?? null
    };

    console.info('[LICHSUTONKHO INSERT ATTEMPT]', JSON.stringify(details));

    try {
        const result = await request.query(query);
        console.info('[LICHSUTONKHO INSERT OK]', JSON.stringify({
            api: details.api,
            operation: details.operation,
            maPhieu: details.maPhieu,
            maNVL: details.maNVL,
            loaiBienDong: movementType.value
        }));
        return result;
    } catch (error) {
        const sqlErrorNumber = getSqlErrorNumber(error);
        if (sqlErrorNumber === 547 || String(error?.message || '').includes('CK_LSK_Loai')) {
            console.error('[LICHSUTONKHO CHECK CONSTRAINT ERROR]', JSON.stringify({
                ...details,
                sqlErrorNumber,
                sqlErrorMessage: error.message,
                precedingErrors: Array.isArray(error.precedingErrors)
                    ? error.precedingErrors.map((item) => ({ number: item.number, message: item.message }))
                    : []
            }));
        }
        throw error;
    }
}

module.exports = { insertInventoryHistory };
