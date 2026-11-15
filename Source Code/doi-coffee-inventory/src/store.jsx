
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { getMaterials, mapActiveMaterialsFromAPI } from './service/materialApi.js'
import { getInventoryHistory } from './service/inventoryHistoryApi.js'
import { apiFetch, API_URL as BASE_API_URL } from './service/apiClient.js'

const Ctx = createContext(null)
export const useStore = () => useContext(Ctx)

const KEY = 'doi-coffee-store-v1'
const API_URL = BASE_API_URL

const nextCode = (prefix, list, pad) => {
  const max = list.reduce(
    (m, x) => Math.max(m, parseInt(String(x.id).replace(/\D/g, ''), 10) || 0),
    0
  )
  return prefix + String(max + 1).padStart(pad, '0')
}

const initial = {
  materials: [],
  suppliers: [],
  slips: [],
  transactions: [],
  recipes: [],
  receipts: [],
  trash: [],
  trashInitialized: true
}

const makeTransactions = (rows, existing, build) => {
  const made = []

  rows.forEach((row) => {
    const id = nextCode('GD', [...existing, ...made], 5)
    made.push(build(row, id))
  })

  return made
}

const recalculateExpiry = (materials, receipts) =>
  materials.map((m) => {
    const expiries = receipts
      .filter((r) => !r.deleted)
      .flatMap((r) => r.items || [])
      .filter((i) => i.materialId === m.id && i.qty > 0 && i.expiry)
      .map((i) => i.expiry)
      .sort()

    const hasReceiptLot = receipts.some((r) =>
      (r.items || []).some((i) => i.materialId === m.id)
    )

    return {
      ...m,
      expiry: expiries[0] || (hasReceiptLot ? '' : m.expiry || '')
    }
  })

export const normalizeText = (value = '') =>
  String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .trim()
    .toLocaleLowerCase('vi-VN')

const localDateTime = () => {
  const d = new Date()
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

// Chuyển dữ liệu danh sách phiếu nhập từ Backend sang Frontend
const mapReceiptFromAPI = (r) => ({
  id: r.maPhieuNhap,
  supplierId: r.maNCC,
  supplier: r.tenNCC,
  date: r.ngayNhap ? String(r.ngayNhap).slice(0, 10) : '',
  total: Number(r.tongTien) || 0,
  note: r.ghiChu || '',
  items: []
})

// Chuyển dữ liệu chi tiết phiếu nhập từ Backend sang Frontend
const mapReceiptDetailFromAPI = (r) => ({
  ...mapReceiptFromAPI(r),
  items: (r.chiTiet || []).map((item) => ({
    materialId: item.maNVL,
    materialName: item.tenNVL,
    qty: Number(item.soLuong),
    remainingQty: Number(item.soLuongConLai),
    unitPrice: Number(item.donGia),
    expiry: item.hanSuDung
      ? String(item.hanSuDung).slice(0, 10)
      : ''
  }))
})

// Chuyển phiếu hao hụt từ Backend sang cấu trúc đang dùng trong giao diện.
const mapLossSlipFromAPI = (slip) => ({
  id: String(slip.maPhieuHaoHut || '').trim(),
  created: slip.ngayLap ? String(slip.ngayLap).slice(0, 10) : '',
  date: slip.ngayHaoHut ? String(slip.ngayHaoHut).slice(0, 10) : '',
  reason: slip.lyDo || '',
  note: slip.ghiChu || '',
  status: slip.trangThai || '',
  items: (slip.chiTiet || []).map((item) => ({
    materialId: String(item.maNVL || '').trim(),
    materialName: item.tenNVL || '',
    qty: Number(item.soLuong) || 0,
    unit: item.donViTinh || ''
  }))
})

// Chuẩn hóa chi tiết phiếu nhập từ Form
const normalizeReceiptItems = (items = []) =>
  items.map((item) => ({
    ...item,
    qty: Number(item.qty),
    unitPrice: Number(item.unitPrice),
    expiry: item.expiry || ''
  }))

// Chuyển dữ liệu Frontend sang cấu trúc Backend
const buildReceiptPayload = (r, supplier) => ({
  maNCC: supplier.id,
  ngayNhap: r.date,
  ghiChu: r.note || null,
  chiTiet: normalizeReceiptItems(r.items).map((item) => ({
    maNVL: item.materialId,
    soLuong: item.qty,
    donGia: item.unitPrice,
    hanSuDung: item.expiry || null
  }))
})

// Chuyển dữ liệu nhà cung cấp từ Backend sang Frontend
const mapSupplierFromAPI = (s) => ({
  id: String(s.maNCC || '').trim(),
  name: s.tenNCC || '',
  phone: String(s.soDienThoai || '').trim(),
  address: s.diaChi || '',
  email: s.email || '',
  deleted: Boolean(s.trangThaiXoa)
})

// Chuyển dữ liệu Frontend sang cấu trúc Backend
const buildSupplierPayload = (s) => ({
  tenNCC: String(s.name || '').trim(),
  soDienThoai: String(s.phone || '').trim(),
  diaChi: String(s.address || '').trim(),
  email: String(s.email || '').trim() || null
})

// Chuyển dữ liệu công thức từ Backend sang Frontend
const mapRecipeFromAPI = (r) => ({
  id: String(r.maMon || '').trim(),
  name: r.tenMon || '',
  group: r.nhomMon || '',
  type: r.loaiCongThuc || 'Món chính',
  unit: r.donViTinh || 'Ly',
  status: r.trangThai || 'Đang kinh doanh',
  note: '',
  items: (r.items || []).map((item) => ({
    materialId: String(item.maNVL || '').trim(),
    qty: Number(item.dinhLuong) || 0,
    unit:
      item.donViDinhLuong ||
      item.donViQuyDoi ||
      item.donViTinh ||
      '',
    note: item.ghiChuPhaChe || ''
  }))
})

// Chuyển dữ liệu Frontend sang cấu trúc Backend
const buildRecipePayload = (r) => ({
  name: String(r.name || '').trim(),
  group: String(r.group || '').trim(),
  type: r.type || 'Món chính',
  unit: r.unit || 'Ly',
  items: (r.items || []).map((item) => ({
    materialId: item.materialId,
    qty: Number(item.qty),
    note: item.note || ''
  }))
})

// Đọc kết quả trả về từ Backend
const readApiResponse = async (response) => {
  let result

  try {
    result = await response.json()
  } catch {
    throw new Error('Backend trả về dữ liệu không hợp lệ!')
  }

  if (!response.ok || !result.success) {
    throw new Error(
      result?.message ||
      result?.error ||
      'Không thể thực hiện thao tác!'
    )
  }

  return result
}

const makeInitialState = () => ({
  ...initial,
  materials: [],
  notifications: []
})

const withNotice = (s, patch, title, message, type = 'success') => {
  const current = s.notifications || []

  const notice = {
    id: nextCode('TB', current, 6),
    title,
    message,
    time: localDateTime(),
    type,
    read: false
  }

  return {
    ...patch,
    notifications: [notice, ...current].slice(0, 100)
  }
}

export function StoreProvider({ children }) {
  const [materialsLoading, setMaterialsLoading] = useState(true)
  const [materialsError, setMaterialsError] = useState('')
  const materialsRequestId = useRef(0)
  const [receiptsLoading, setReceiptsLoading] = useState(true)
  const [receiptsError, setReceiptsError] = useState('')
  const [recipesLoading, setRecipesLoading] = useState(true)
  const [recipesError, setRecipesError] = useState('')
  const [lossesLoading, setLossesLoading] = useState(true)
  const [lossesError, setLossesError] = useState('')
  const [inventoryHistory, setInventoryHistory] = useState([])
  const [trash, setTrash] = useState([])
  const [inventoryHistoryLoading, setInventoryHistoryLoading] = useState(true)
  const [inventoryHistoryLoadError, setInventoryHistoryLoadError] = useState('')
  const inventoryHistoryRequestId = useRef(0)
  const lossCreateInFlight = useRef(false)
  const [state, setState] = useState(() => {
    const fresh = makeInitialState()
    // Không hiển thị phiếu mẫu như thể chúng được tải từ SQL Server.
    fresh.slips = []

    try {
      const raw = localStorage.getItem(KEY)

      if (!raw) return fresh

      const saved = JSON.parse(raw)

      return {
        ...fresh,
        ...saved,
        materials: [],
        suppliers: [],
        slips: [],
        receipts: [],
        recipes: [],
        transactions: [],
        trash: [],
        trashInitialized: true,
        notifications: saved.notifications ?? fresh.notifications
      }
    } catch {
      return fresh
    }
  })

  // Lưu trạng thái hiện tại vào localStorage
  const refreshMaterials = async () => {
    const requestId = ++materialsRequestId.current
    setMaterialsLoading(true)
    setMaterialsError('')

    try {
      const data = await getMaterials()
      const materials = mapActiveMaterialsFromAPI(data)
      if (requestId === materialsRequestId.current) {
        setState((prev) => ({ ...prev, materials }))
      }
      return { success: true, data: materials }
    } catch (error) {
      const message = error.message || 'Không thể tải danh mục nguyên vật liệu từ SQL Server!'
      if (requestId === materialsRequestId.current) {
        setState((prev) => ({ ...prev, materials: [] }))
        setMaterialsError(message)
      }
      return { success: false, message }
    } finally {
      if (requestId === materialsRequestId.current) setMaterialsLoading(false)
    }
  }

  const refreshInventoryHistory = async () => {
    const requestId = ++inventoryHistoryRequestId.current
    setInventoryHistoryLoading(true)
    setInventoryHistoryLoadError('')

    try {
      const [data, deleted] = await Promise.all([getInventoryHistory(), getInventoryHistory(true)])
      if (requestId === inventoryHistoryRequestId.current) {
        setInventoryHistory(data)
        setTrash(deleted.filter((entry) => entry.deleted))
      }
      return { success: true, data }
    } catch (error) {
      const message = error.message || 'Không thể tải lịch sử tồn kho từ SQL Server!'
      if (requestId === inventoryHistoryRequestId.current) {
        setInventoryHistory([])
        setTrash([])
        setInventoryHistoryLoadError(message)
      }
      return { success: false, message }
    } finally {
      if (requestId === inventoryHistoryRequestId.current) {
        setInventoryHistoryLoading(false)
      }
    }
  }

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify({ notifications: state.notifications || [] }))
  }, [state.notifications])

  useEffect(() => {
    refreshMaterials()
  }, [])

  useEffect(() => {
    refreshInventoryHistory()
  }, [])

  // Tải danh sách nhà cung cấp từ SQL Server
  useEffect(() => {
    let cancelled = false

    const loadSuppliers = async () => {
      try {
        const response = await apiFetch(`${API_URL}/suppliers`)
        const result = await readApiResponse(response)

        if (cancelled) return

        setState((prev) => ({
          ...prev,
          suppliers: (result.data || []).map(mapSupplierFromAPI)
        }))
      } catch (error) {
        console.error('Lỗi tải danh sách nhà cung cấp:', error)
      }
    }

    loadSuppliers()

    return () => {
      cancelled = true
    }
  }, [])

  // Tải danh sách phiếu hao hụt từ SQL Server.
  useEffect(() => {
    let cancelled = false

    const loadLossSlips = async () => {
      setLossesLoading(true)
      setLossesError('')

      try {
        const response = await apiFetch(`${API_URL}/losses`)
        const result = await readApiResponse(response)

        if (cancelled) return

        setState((prev) => ({
          ...prev,
          slips: (result.data || []).map(mapLossSlipFromAPI)
        }))
      } catch (error) {
        if (cancelled) return

        setState((prev) => ({ ...prev, slips: [] }))
        setLossesError(error.message || 'Không thể tải danh sách phiếu hao hụt từ Backend!')
      } finally {
        if (!cancelled) setLossesLoading(false)
      }
    }

    loadLossSlips()

    return () => {
      cancelled = true
    }
  }, [])

  // Tải danh sách phiếu nhập từ SQL Server thông qua Backend
  useEffect(() => {
    let cancelled = false

    const loadReceipts = async () => {
      setReceiptsLoading(true)
      setReceiptsError('')
      try {
        const response = await apiFetch(`${API_URL}/receipts`)
        const result = await readApiResponse(response)

        if (cancelled) return

        const apiReceipts = await Promise.all((result.data || []).map(async (item) => {
          const detailResponse = await apiFetch(`${API_URL}/receipts/${encodeURIComponent(item.maPhieuNhap)}`)
          const detailResult = await readApiResponse(detailResponse)
          return mapReceiptDetailFromAPI(detailResult.data)
        }))

        if (cancelled) return
        setState((prev) => ({ ...prev, receipts: apiReceipts }))
      } catch (error) {
        if (!cancelled) {
          setState((prev) => ({ ...prev, receipts: [] }))
          setReceiptsError(error.message || 'Không thể tải danh sách phiếu nhập từ SQL Server!')
        }
        console.error('Lỗi tải danh sách phiếu nhập:', error)
      } finally {
        if (!cancelled) setReceiptsLoading(false)
      }
    }

    loadReceipts()

    return () => {
      cancelled = true
    }
  }, [])

  // Tải danh sách công thức món từ SQL Server
  useEffect(() => {
    let cancelled = false

    const loadRecipes = async () => {
      setRecipesLoading(true)
      setRecipesError('')
      try {
        const response = await apiFetch(`${API_URL}/recipes`)
        const result = await readApiResponse(response)

        if (cancelled) return

        setState((prev) => ({
          ...prev,
          recipes: (result.data || []).map(mapRecipeFromAPI)
        }))
      } catch (error) {
        if (!cancelled) {
          setState((prev) => ({ ...prev, recipes: [] }))
          setRecipesError(error.message || 'Không thể tải danh sách công thức từ SQL Server!')
        }
        console.error('Lỗi tải danh sách công thức món:', error)
      } finally {
        if (!cancelled) setRecipesLoading(false)
      }
    }

    loadRecipes()

    return () => {
      cancelled = true
    }
  }, [])

  const set = (patch) =>
    setState((s) => ({ ...s, ...patch(s) }))

  const actions = {
    reset: () => {
      setState(makeInitialState())
      refreshMaterials()
    },
    refreshMaterials,

    markNotificationRead: (id) =>
      set((s) => ({
        notifications: (s.notifications || []).map((n) =>
          n.id === id ? { ...n, read: true } : n
        )
      })),

    markAllNotificationsRead: () =>
      set((s) => ({
        notifications: (s.notifications || []).map((n) => ({
          ...n,
          read: true
        }))
      })),

    // ---------- Nguyên vật liệu ----------
    addMaterial: (m) =>
      set((s) =>
        withNotice(
          s,
          {
            materials: [
              ...s.materials,
              { ...m, id: nextCode('NVL', s.materials, 4) }
            ]
          },
          'Đã thêm nguyên vật liệu',
          m.name
        )
      ),

    updateMaterial: (id, m) =>
      set((s) =>
        withNotice(
          s,
          {
            materials: s.materials.map((x) =>
              x.id === id ? { ...x, ...m } : x
            )
          },
          'Đã cập nhật nguyên vật liệu',
          m.name
        )
      ),

    deleteMaterial: (id) =>
      set((s) => {
        const item = s.materials.find((x) => x.id === id)

        return withNotice(
          s,
          {
            materials: s.materials.map((x) =>
              x.id === id ? { ...x, deleted: true } : x
            )
          },
          'Đã xóa nguyên vật liệu',
          item?.name || id
        )
      }),

    isMaterialUsed: (id) =>
      state.recipes.some((r) =>
        r.items.some((i) => i.materialId === id)
      ) ||
      state.slips.some(
        (sl) =>
          sl.status !== 'Đã hủy' &&
          sl.items.some((i) => i.materialId === id)
      ) ||
      state.receipts.some(
        (r) =>
          !r.deleted &&
          (r.items || []).some((i) => i.materialId === id)
      ),

    // ---------- Nhà cung cấp ----------

    // Thêm nhà cung cấp vào SQL Server
    addSupplier: async (v) => {
      try {
        const response = await apiFetch(`${API_URL}/suppliers`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(buildSupplierPayload(v))
        })

        const result = await readApiResponse(response)
        const newSupplier = mapSupplierFromAPI(result.data)

        set((s) =>
          withNotice(
            s,
            {
              suppliers: [...s.suppliers, newSupplier]
            },
            'Đã thêm nhà cung cấp',
            newSupplier.name
          )
        )

        return {
          success: true,
          message: result.message || 'Thêm nhà cung cấp thành công!',
          data: newSupplier
        }
      } catch (error) {
        console.error('Lỗi thêm nhà cung cấp:', error)

        return {
          success: false,
          message: error.message || 'Không thể kết nối Backend!'
        }
      }
    },

    // Cập nhật nhà cung cấp trên SQL Server
    updateSupplier: async (id, v) => {
      try {
        const response = await apiFetch(
          `${API_URL}/suppliers/${encodeURIComponent(id)}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(buildSupplierPayload(v))
          }
        )

        const result = await readApiResponse(response)
        const updatedSupplier = mapSupplierFromAPI(result.data)

        set((s) =>
          withNotice(
            s,
            {
              suppliers: s.suppliers.map((x) =>
                x.id === id ? updatedSupplier : x
              )
            },
            'Đã cập nhật nhà cung cấp',
            updatedSupplier.name
          )
        )

        return {
          success: true,
          message: result.message || 'Cập nhật nhà cung cấp thành công!',
          data: updatedSupplier
        }
      } catch (error) {
        console.error('Lỗi cập nhật nhà cung cấp:', error)

        return {
          success: false,
          message: error.message || 'Không thể kết nối Backend!'
        }
      }
    },

    // Xóa mềm nhà cung cấp trên SQL Server
    deleteSupplier: async (id) => {
      try {
        const supplier = state.suppliers.find((x) => x.id === id)

        if (!supplier) {
          return {
            success: false,
            message: 'Không tìm thấy nhà cung cấp!'
          }
        }

        const response = await apiFetch(
          `${API_URL}/suppliers/${encodeURIComponent(id)}`,
          {
            method: 'DELETE'
          }
        )

        const result = await readApiResponse(response)

        set((s) =>
          withNotice(
            s,
            {
              suppliers: s.suppliers.map((x) =>
                x.id === id ? { ...x, deleted: true } : x
              )
            },
            'Đã xóa nhà cung cấp',
            supplier.name
          )
        )

        return {
          success: true,
          message: result.message || 'Xóa nhà cung cấp thành công!'
        }
      } catch (error) {
        console.error('Lỗi xóa nhà cung cấp:', error)

        return {
          success: false,
          message: error.message || 'Không thể kết nối Backend!'
        }
      }
    },

    // Kiểm tra nhà cung cấp đang được sử dụng
    isSupplierUsed: (name) =>
      state.materials.some(
        (m) => !m.deleted && m.supplier === name
      ) ||
      state.receipts.some(
        (r) => !r.deleted && r.supplier === name
      ),

    // ---------- Phiếu hao hụt ----------
    createSlip: async ({ date, reason, note, items }) => {
      if (lossCreateInFlight.current) {
        return { success: false, message: 'Yêu cầu tạo phiếu đang được xử lý. Vui lòng chờ!' }
      }

      lossCreateInFlight.current = true

      try {
        const payload = {
          ngayHaoHut: date,
          lyDo: reason,
          ghiChu: String(note || '').trim() || null,
          chiTiet: items.map((item) => ({
            maNVL: String(item.materialId || '').trim(),
            soLuong: Number(item.qty)
          }))
        }

        const response = await apiFetch(`${API_URL}/losses`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        const result = await readApiResponse(response)

        await refreshMaterials()

        // Sau POST thành công, tải lại danh sách chuẩn từ SQL Server.
        setLossesLoading(true)
        setLossesError('')

        let refreshMessage = ''
        try {
          const listResponse = await apiFetch(`${API_URL}/losses`)
          const listResult = await readApiResponse(listResponse)
          setState((prev) => ({
            ...prev,
            slips: (listResult.data || []).map(mapLossSlipFromAPI)
          }))
        } catch (error) {
          setState((prev) => ({ ...prev, slips: [] }))
          refreshMessage = ` Phiếu đã được tạo nhưng không tải lại được danh sách: ${error.message}`
          setLossesError(error.message || 'Không thể tải lại danh sách phiếu hao hụt!')
        } finally {
          setLossesLoading(false)
        }

        return {
          success: true,
          message: `${result.message || 'Tạo phiếu hao hụt thành công!'}${refreshMessage}`,
          data: result.data
        }
      } catch (error) {
        return {
          success: false,
          message: error.message || 'Không thể tạo phiếu hao hụt từ Backend!'
        }
      } finally {
        lossCreateInFlight.current = false
      }
    },

    updateSlip: async (id, { date, reason, note, items }) => {
      try {
        const response = await apiFetch(`${API_URL}/losses/${encodeURIComponent(id)}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ngayHaoHut: date, lyDo: reason, ghiChu: String(note || '').trim() || null,
            chiTiet: items.map((item) => ({ maNVL: item.materialId, soLuong: Number(item.qty) })) })
        })
        const result = await readApiResponse(response)
        await Promise.all([actions.refreshMaterials(), refreshInventoryHistory()])
        const listResponse = await apiFetch(`${API_URL}/losses`)
        const listResult = await readApiResponse(listResponse)
        setState((prev) => ({ ...prev, slips: (listResult.data || []).map(mapLossSlipFromAPI) }))
        return { success: true, message: result.message || 'Cập nhật phiếu hao hụt thành công!' }
      } catch (error) { return { success: false, message: error.message || 'Không thể cập nhật phiếu hao hụt!' } }
    },

    cancelSlip: async (id) => {
      try {
        const response = await apiFetch(`${API_URL}/losses/${encodeURIComponent(id)}/cancel`, { method: 'PATCH' })
        const result = await readApiResponse(response)
        if (
          String(result?.data?.maPhieuHaoHut || '').trim() !== String(id).trim() ||
          String(result?.data?.trangThai || '').trim() !== 'Đã hủy'
        ) {
          throw new Error('Backend chưa xác nhận trạng thái hủy của phiếu.')
        }
        await Promise.all([actions.refreshMaterials(), refreshInventoryHistory()])
        const listResponse = await apiFetch(`${API_URL}/losses`)
        const listResult = await readApiResponse(listResponse)
        const slips = (listResult.data || []).map(mapLossSlipFromAPI)
        const cancelledSlip = slips.find((slip) => slip.id === String(id).trim())
        if (cancelledSlip?.status !== 'Đã hủy') {
          throw new Error(`Chưa xác nhận được trạng thái mới của phiếu ${String(id).trim()} từ danh sách Backend.`)
        }
        setState((prev) => ({ ...prev, slips }))
        return { success: true, message: result.message || 'Hủy phiếu hao hụt thành công!' }
      } catch (error) { return { success: false, message: error.message || 'Không thể hủy phiếu hao hụt!' } }
    },
    // ---------- Công thức món ----------

    // Thêm công thức món vào SQL Server
    addRecipe: async (r) => {
      try {
        const payload = buildRecipePayload(r)

        const response = await apiFetch(`${API_URL}/recipes`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        })

        const result = await readApiResponse(response)
        const maMon = String(result.data.maMon || '').trim()

        if (!maMon) {
          throw new Error('Backend không trả về mã món!')
        }

        const newRecipe = {
          ...r,
          id: maMon,
          status: 'Đang kinh doanh'
        }

        set((s) =>
          withNotice(
            s,
            {
              recipes: [...s.recipes, newRecipe]
            },
            'Đã thêm công thức món',
            `${maMon}: ${r.name}`
          )
        )

        return {
          success: true,
          message: result.message || 'Thêm công thức món thành công!',
          data: newRecipe
        }
      } catch (error) {
        console.error('Lỗi thêm công thức món:', error)

        return {
          success: false,
          message: error.message || 'Không thể kết nối Backend!'
        }
      }
    },

    // Cập nhật công thức món trên SQL Server
    updateRecipe: async (id, r) => {
      try {
        const payload = buildRecipePayload(r)

        const response = await apiFetch(
          `${API_URL}/recipes/${encodeURIComponent(id)}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          }
        )

        const result = await readApiResponse(response)

        set((s) =>
          withNotice(
            s,
            {
              recipes: s.recipes.map((x) =>
                x.id === id
                  ? { ...x, ...r, id, status: x.status }
                  : x
              )
            },
            'Đã cập nhật công thức món',
            r.name
          )
        )

        return {
          success: true,
          message: result.message || 'Cập nhật công thức món thành công!'
        }
      } catch (error) {
        console.error('Lỗi cập nhật công thức món:', error)

        return {
          success: false,
          message: error.message || 'Không thể kết nối Backend!'
        }
      }
    },

    // Xóa công thức món trên SQL Server
    deleteRecipe: async (id) => {
      try {
        const recipe = state.recipes.find((x) => x.id === id)

        if (!recipe) {
          return {
            success: false,
            message: 'Không tìm thấy công thức món!'
          }
        }

        const response = await apiFetch(
          `${API_URL}/recipes/${encodeURIComponent(id)}`,
          {
            method: 'DELETE'
          }
        )

        const result = await readApiResponse(response)

        set((s) =>
          withNotice(
            s,
            {
              recipes: s.recipes.filter((x) => x.id !== id)
            },
            'Đã xóa công thức món',
            recipe.name
          )
        )

        return {
          success: true,
          message: result.message || 'Xóa công thức món thành công!'
        }
      } catch (error) {
        console.error('Lỗi xóa công thức món:', error)

        return {
          success: false,
          message: error.message || 'Không thể kết nối Backend!'
        }
      }
    },

    // ---------- Phiếu nhập kho ----------

    // Lấy chi tiết phiếu nhập từ Backend
    getReceiptDetail: async (id) => {
      try {
        const response = await apiFetch(`${API_URL}/receipts/${id}`)
        const result = await readApiResponse(response)

        const receipt = mapReceiptDetailFromAPI(result.data)

        set((s) => ({
          receipts: s.receipts.map((r) =>
            r.id === id ? { ...r, ...receipt } : r
          )
        }))

        return {
          success: true,
          data: receipt
        }
      } catch (error) {
        console.error('Lỗi tải chi tiết phiếu nhập:', error)

        return {
          success: false,
          message: error.message || 'Không thể kết nối Backend!'
        }
      }
    },

    // Tạo phiếu nhập kho
    addReceipt: async (r) => {
      try {
        const supplier = state.suppliers.find(
          (s) => s.id === r.supplier || s.name === r.supplier
        )

        if (!supplier) {
          return {
            success: false,
            message: 'Không tìm thấy nhà cung cấp!'
          }
        }

        const items = normalizeReceiptItems(r.items)

        if (!items.length) {
          return {
            success: false,
            message: 'Phiếu nhập phải có ít nhất một nguyên vật liệu!'
          }
        }

        const payload = buildReceiptPayload(
          { ...r, items },
          supplier
        )

        const response = await apiFetch(`${API_URL}/receipts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        })

        const result = await readApiResponse(response)
        const serverData = result.data

        set((s) => {
          let materials = s.materials

          items.forEach((it) => {
            materials = materials.map((m) =>
              m.id === it.materialId
                ? {
                    ...m,
                    stock: +(Number(m.stock) + it.qty).toFixed(3)
                  }
                : m
            )
          })

          const receipt = {
            ...r,
            ...(items.length && { items }),
            id: serverData.maPhieuNhap,
            supplierId: supplier.id,
            supplier: supplier.name,
            total: Number(serverData.tongTien) || 0,
            status: 'Hoàn thành',
            deleted: false
          }

          const transactions = makeTransactions(
            items,
            s.transactions,
            (it, txId) => ({
              id: txId,
              time: localDateTime(),
              materialId: it.materialId,
              type: 'Nhập kho',
              delta: it.qty,
              source: receipt.id
            })
          )

          const receipts = [receipt, ...s.receipts]

          return withNotice(
            s,
            {
              materials: recalculateExpiry(materials, receipts),
              receipts,
              transactions: [...transactions, ...s.transactions]
            },
            'Đã tạo phiếu nhập kho',
            `${receipt.id}: ${receipt.supplier}, tổng ${receipt.total.toLocaleString('vi-VN')} VNĐ.`
          )
        })

        await refreshMaterials()

        return {
          success: true,
          message: result.message || 'Tạo phiếu nhập kho thành công!',
          data: serverData
        }
      } catch (error) {
        console.error('Lỗi tạo phiếu nhập kho:', error)

        return {
          success: false,
          message: error.message || 'Không thể kết nối Backend!'
        }
      }
    },

    // Cập nhật phiếu nhập kho
    updateReceipt: async (id, r) => {
      try {
        const old = state.receipts.find((x) => x.id === id)

        if (!old || old.deleted) {
          return {
            success: false,
            message: 'Không tìm thấy phiếu nhập kho!'
          }
        }

        const supplier = state.suppliers.find(
          (s) => s.id === r.supplier || s.name === r.supplier
        )

        if (!supplier) {
          return {
            success: false,
            message: 'Không tìm thấy nhà cung cấp!'
          }
        }

        const items = normalizeReceiptItems(r.items)

        if (!items.length) {
          return {
            success: false,
            message: 'Phiếu nhập phải có ít nhất một nguyên vật liệu!'
          }
        }

        const detailResponse = await apiFetch(`${API_URL}/receipts/${id}`)
        const detailResult = await readApiResponse(detailResponse)
        const oldReceipt = mapReceiptDetailFromAPI(detailResult.data)

        const payload = buildReceiptPayload(
          { ...r, items },
          supplier
        )

        const response = await apiFetch(`${API_URL}/receipts/${id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        })

        const result = await readApiResponse(response)

        const before = new Map()
        const after = new Map()

        oldReceipt.items.forEach((item) => {
          before.set(
            item.materialId,
            (before.get(item.materialId) || 0) + Number(item.qty)
          )
        })

        items.forEach((item) => {
          after.set(
            item.materialId,
            (after.get(item.materialId) || 0) + Number(item.qty)
          )
        })

        const deltas = new Map(
          [...new Set([...before.keys(), ...after.keys()])].map((mid) => [
            mid,
            (after.get(mid) || 0) - (before.get(mid) || 0)
          ])
        )

        set((s) => {
          let materials = s.materials

          for (const [mid, delta] of deltas) {
            if (!delta) continue

            materials = materials.map((m) =>
              m.id === mid
                ? {
                    ...m,
                    stock: +Math.max(0, Number(m.stock) + delta).toFixed(3)
                  }
                : m
            )
          }

          const transactions = makeTransactions(
            [...deltas.entries()].filter(([, delta]) => delta !== 0),
            s.transactions,
            ([materialId, delta], txId) => ({
              id: txId,
              time: localDateTime(),
              materialId,
              type: delta > 0 ? 'Nhập kho' : 'Điều chỉnh',
              delta,
              reason: 'Điều chỉnh phiếu nhập kho',
              source: id
            })
          )

          const updatedReceipt = {
            ...oldReceipt,
            ...r,
            id,
            supplierId: supplier.id,
            supplier: supplier.name,
            items,
            total: Number(result.data?.tongTien) || 0,
            status: 'Hoàn thành',
            deleted: false
          }

          const receipts = s.receipts.map((x) =>
            x.id === id ? updatedReceipt : x
          )

          return withNotice(
            s,
            {
              materials: recalculateExpiry(materials, receipts),
              receipts,
              transactions: [...transactions, ...s.transactions]
            },
            'Đã cập nhật phiếu nhập kho',
            `${id} đã được lưu.`
          )
        })

        await refreshMaterials()

        return {
          success: true,
          message: result.message || 'Cập nhật phiếu nhập kho thành công!',
          data: result.data
        }
      } catch (error) {
        console.error('Lỗi cập nhật phiếu nhập kho:', error)

        return {
          success: false,
          message: error.message || 'Không thể kết nối Backend!'
        }
      }
    },

    // Xóa mềm phiếu nhập kho
    deleteReceipt: async (id) => {
      try {
        const receipt = state.receipts.find((x) => x.id === id)

        if (!receipt || receipt.deleted) {
          return {
            success: false,
            message: 'Không tìm thấy phiếu nhập kho!'
          }
        }

        const detailResponse = await apiFetch(`${API_URL}/receipts/${id}`)
        const detailResult = await readApiResponse(detailResponse)

        const receiptItems = (detailResult.data.chiTiet || []).map((item) => ({
          materialId: item.maNVL,
          qty: Number(item.soLuong)
        }))

        const response = await apiFetch(`${API_URL}/receipts/${id}`, {
          method: 'DELETE'
        })

        const result = await readApiResponse(response)

        set((s) => {
          let materials = s.materials

          receiptItems.forEach((it) => {
            materials = materials.map((m) =>
              m.id === it.materialId
                ? {
                    ...m,
                    stock: +Math.max(
                      0,
                      Number(m.stock) - it.qty
                    ).toFixed(3)
                  }
                : m
            )
          })

          const transactions = makeTransactions(
            receiptItems,
            s.transactions,
            (it, txId) => ({
              id: txId,
              time: localDateTime(),
              materialId: it.materialId,
              type: 'Điều chỉnh',
              delta: -it.qty,
              reason: 'Đảo nhập do xóa mềm phiếu nhập',
              source: id
            })
          )

          const receipts = s.receipts.map((x) =>
            x.id === id ? { ...x, deleted: true } : x
          )

          return withNotice(
            s,
            {
              materials: recalculateExpiry(materials, receipts),
              receipts,
              transactions: [...transactions, ...s.transactions]
            },
            'Đã xóa phiếu nhập kho',
            `${id}: tồn kho đã được điều chỉnh lại.`
          )
        })

        await refreshMaterials()

        return {
          success: true,
          message: result.message || 'Xóa phiếu nhập kho thành công!'
        }
      } catch (error) {
        console.error('Lỗi xóa phiếu nhập:', error)

        return {
          success: false,
          message: error.message || 'Không thể kết nối đến máy chủ!'
        }
      }
    }
  }

  const materialGroups = [...new Set(
    state.materials.filter((material) => !material.deleted).map((material) => material.group).filter(Boolean)
  )]
  const inventoryHistoryAvailable = !inventoryHistoryLoading && !inventoryHistoryLoadError
  const inventoryHistoryError = inventoryHistoryLoadError || 'Inventory history is loading from SQL Server.'

  return (
    <Ctx.Provider value={{ ...state, trash, transactions: inventoryHistory.map((entry) => ({ id: entry.id, materialId: entry.materialId, type: entry.type, delta: entry.delta, time: entry.time, reason: entry.note, source: entry.source, reversalOf: entry.originalHistoryId })), ...actions, materialGroups, materialsLoading, materialsError, receiptsLoading, receiptsError, recipesLoading, recipesError, lossesLoading, lossesError, inventoryHistory, inventoryHistoryLoading, inventoryHistoryLoadError, inventoryHistoryError, inventoryHistoryAvailable, refreshInventoryHistory }}>
      {children}
    </Ctx.Provider>
  )
}
