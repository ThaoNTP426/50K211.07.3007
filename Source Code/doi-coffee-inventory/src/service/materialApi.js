import { apiFetch, API_URL as BASE_API_URL } from './apiClient.js'
const API_URL = `${BASE_API_URL}/materials`;

const isDeleted = (value) =>
    value === true || value === 1 || value === '1';

// Shared API-to-UI mapping for the SQL Server material catalog.
export const mapMaterialFromAPI = (item) => ({
    id: String(item.maNVL || '').trim(),
    name: item.tenNVL || '',
    group: item.nhomNVL || '',
    supplier: String(item.maNCC || '').trim(),
    unit: item.donViTinh || '',
    subUnit: item.donViQuyDoi || '',
    ratio: item.tyLeQuyDoi == null ? '' : Number(item.tyLeQuyDoi),
    stock: Number(item.tonHienTai) || 0,
    min: Number(item.mucTonToiThieu) || 0,
    deleted: isDeleted(item.trangThaiXoa),
    expiry: ''
});

export const mapActiveMaterialsFromAPI = (items) =>
    (Array.isArray(items) ? items : [])
        .map(mapMaterialFromAPI)
        .filter((item) => item.id && !item.deleted);

// Hàm gửi yêu cầu đến Backend
async function requestMaterials(url, options) {
    const response = await apiFetch(url, options);
    const result = await response.json();

    if (!response.ok || !result.success) {
        throw new Error(
            result.message || 'Yêu cầu API không thành công!'
        );
    }

    return result;
}

// GET - Lấy danh sách
export const getMaterials = async () => {
    const result = await requestMaterials(API_URL);
    return result.data;
};

// POST - Thêm nguyên vật liệu
export const addMaterial = (data) =>
    requestMaterials(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    });

// PUT - Sửa nguyên vật liệu
export const updateMaterial = (maNVL, data) =>
    requestMaterials(
        API_URL + '/' + encodeURIComponent(maNVL),
        {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        }
    );

// DELETE - Xóa mềm
export const deleteMaterial = (maNVL) =>
    requestMaterials(
        API_URL + '/' + encodeURIComponent(maNVL),
        {
            method: 'DELETE'
        }
    );
