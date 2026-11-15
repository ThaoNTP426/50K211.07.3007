
import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Check,
  Coffee,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  X,
  AlertCircle
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { apiFetch, API_URL } from '../service/apiClient.js'

const newInvoiceCode = () =>
  `POS-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().replaceAll('-', '').slice(0, 4).toUpperCase()}`

const formatDate = (value) =>
  new Date(value).toLocaleString('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short'
  })

export default function Pos({ onLogout }) {
  const [mainDishes, setMainDishes] = useState([])
  const [extras, setExtras] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [checkoutError, setCheckoutError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('Tất cả')
  const [cart, setCart] = useState([])
  const [invoice, setInvoice] = useState(null)

  // Tải menu POS từ backend.
  const loadMenu = async () => {
    setLoading(true)
    setError('')

    try {
      const response = await apiFetch(`${API_URL}/pos/menu`)
      const result = await response.json()

      if (!response.ok || !result?.success) {
        throw new Error(result?.message || 'Không thể tải danh sách món.')
      }

      setMainDishes(Array.isArray(result.data?.monChinh) ? result.data.monChinh : [])
      setExtras(Array.isArray(result.data?.extras) ? result.data.extras : [])
    } catch (e) {
      setError(e.message || 'Không thể kết nối đến máy chủ.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMenu()
  }, [])

  const groups = useMemo(
    () => ['Tất cả', ...new Set(mainDishes.map((item) => item.nhomMon).filter(Boolean))],
    [mainDishes]
  )

  const visible = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('vi')

    return mainDishes.filter((item) => {
      const matchesGroup = group === 'Tất cả' || item.nhomMon === group
      const matchesQuery = `${item.maMon} ${item.tenMon} ${item.nhomMon || ''}`
        .toLocaleLowerCase('vi')
        .includes(keyword)

      return matchesGroup && matchesQuery
    })
  }, [mainDishes, group, query])

  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0)
  const extraCount = cart.reduce(
    (sum, item) => sum + item.extras.reduce((total, extra) => total + extra.quantity, 0),
    0
  )

  // Thêm món chính vào hóa đơn.
  const addMainDish = (recipe) => {
    setCheckoutError('')

    setCart((items) => {
      const found = items.find((item) => item.maMon === recipe.maMon)

      if (found) {
        return items.map((item) =>
          item.maMon === recipe.maMon
            ? { ...item, quantity: Math.min(99, item.quantity + 1) }
            : item
        )
      }

      return [
        ...items,
        {
          ...recipe,
          quantity: 1,
          selectedExtra: extras[0]?.maMon || '',
          extras: []
        }
      ]
    })
  }

  const changeMainQuantity = (maMon, delta) => {
    setCart((items) =>
      items.map((item) =>
        item.maMon === maMon
          ? { ...item, quantity: Math.max(1, Math.min(99, item.quantity + delta)) }
          : item
      )
    )
  }

  const removeMainDish = (maMon) => {
    setCart((items) => items.filter((item) => item.maMon !== maMon))
    setCheckoutError('')
  }

  // Chọn Extra cho từng món chính.
  const selectExtra = (maMon, extraCode) => {
    setCart((items) =>
      items.map((item) =>
        item.maMon === maMon ? { ...item, selectedExtra: extraCode } : item
      )
    )
  }

  const addExtra = (maMon) => {
    setCart((items) =>
      items.map((item) => {
        if (item.maMon !== maMon || !item.selectedExtra) return item

        const found = item.extras.find((extra) => extra.maMon === item.selectedExtra)

        if (found) {
          return {
            ...item,
            extras: item.extras.map((extra) =>
              extra.maMon === item.selectedExtra
                ? { ...extra, quantity: Math.min(99, extra.quantity + 1) }
                : extra
            )
          }
        }

        const recipe = extras.find((extra) => extra.maMon === item.selectedExtra)
        if (!recipe) return item

        return {
          ...item,
          extras: [...item.extras, { ...recipe, quantity: 1 }]
        }
      })
    )
    setCheckoutError('')
  }

  const changeExtraQuantity = (mainCode, extraCode, delta) => {
    setCart((items) =>
      items.map((item) => {
        if (item.maMon !== mainCode) return item

        return {
          ...item,
          extras: item.extras.map((extra) =>
            extra.maMon === extraCode
              ? { ...extra, quantity: Math.max(1, Math.min(99, extra.quantity + delta)) }
              : extra
          )
        }
      })
    )
  }

  const removeExtra = (mainCode, extraCode) => {
    setCart((items) =>
      items.map((item) =>
        item.maMon === mainCode
          ? { ...item, extras: item.extras.filter((extra) => extra.maMon !== extraCode) }
          : item
      )
    )
  }

  // Gửi hóa đơn đến backend. Backend chịu trách nhiệm kiểm tra và trừ kho.
  const checkout = async () => {
    if (!cart.length || submitting) return

    setSubmitting(true)
    setCheckoutError('')

    const payload = {
      maHoaDon: newInvoiceCode(),
      trangThai: 'Đã thanh toán',
      thoiGian: new Date().toISOString(),
      items: cart.map((item) => ({
        maMon: item.maMon,
        soLuong: item.quantity,
        extras: item.extras.map((extra) => ({
          maMon: extra.maMon,
          soLuong: extra.quantity
        }))
      }))
    }

    try {
      const response = await apiFetch(`${API_URL}/pos/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })

      const result = await response.json()

      if (!response.ok || !result?.success) {
        throw new Error(result?.message || 'Không thể xử lý thanh toán.')
      }

      setInvoice({
        ...payload,
        result: result.data || null,
        replayed: Boolean(result.replayed),
        message: result.message || 'Thanh toán thành công.'
      })

      setCart([])
    } catch (e) {
      setCheckoutError(e.message || 'Không thể kết nối đến máy chủ.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="pos-shell">
      <header className="pos-header">
        <div className="pos-brand">
          <span className="pos-brand-mark"><Coffee size={21} /></span>
          <div>
            <strong>Đợi Coffee</strong>
            <small>Máy POS</small>
          </div>
        </div>

        <div className="pos-header-actions">
          <span className="pos-live"><i /> Hệ thống sẵn sàng</span>
          <Link to="/nguyen-vat-lieu" className="pos-back">
            <ArrowLeft size={16} /> Quản lý kho
          </Link>
          <button className="pos-logout" onClick={onLogout}>Đăng xuất</button>
        </div>
      </header>

      <div className="pos-workspace">
        <section className="pos-menu">
          <div className="pos-heading">
            <div>
              <span className="pos-eyebrow">ĐỢI COFFEE · QUẦY BÁN HÀNG</span>
              <h1>Chọn món</h1>
              <p>Chọn món chính, sau đó thêm Extra nếu khách có yêu cầu.</p>
            </div>
            <span className="pos-menu-count">{mainDishes.length} món đang bán</span>
          </div>

          <label className="pos-search">
            <Search size={18} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm theo mã món hoặc tên món..."
            />
            <kbd>⌘ K</kbd>
          </label>

          <div className="pos-categories" aria-label="Lọc nhóm món">
            {groups.map((item) => (
              <button
                key={item}
                className={group === item ? 'selected' : ''}
                onClick={() => setGroup(item)}
              >
                {item}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="pos-state">
              <span className="pos-spinner" />
              Đang tải danh sách món từ máy chủ...
            </div>
          ) : error ? (
            <div className="pos-state pos-error">
              <strong>Không tải được danh sách món</strong>
              <span>{error}</span>
              <button onClick={loadMenu}>Thử tải lại</button>
            </div>
          ) : visible.length ? (
            <div className="pos-product-grid">
              {visible.map((item) => (
                <button
                  className="pos-product"
                  key={item.maMon}
                  onClick={() => addMainDish(item)}
                >
                  <span className="pos-product-icon"><Coffee size={23} /></span>
                  <span className="pos-product-group">{item.nhomMon || 'Chưa phân nhóm'}</span>
                  <strong>{item.tenMon}</strong>
                  <span className="pos-product-code">{item.maMon}</span>
                  <span className="pos-add-label"><Plus size={15} /> Thêm món</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="pos-state">Không tìm thấy món phù hợp.</div>
          )}
        </section>

        <aside className="pos-cart">
          <div className="pos-cart-heading">
            <div>
              <span className="pos-eyebrow">ĐƠN HÀNG HIỆN TẠI</span>
              <h2>Hóa đơn</h2>
            </div>
            <span className="pos-cart-badge">{itemCount}</span>
          </div>

          <div className="pos-invoice-meta">
            <span>Mã hóa đơn</span>
            <strong>Tạo khi thanh toán</strong>
            <span>Thời gian</span>
            <strong>{formatDate(new Date())}</strong>
          </div>

          <div className="pos-cart-list">
            {cart.length ? (
              cart.map((item) => (
                <article className="pos-cart-item" key={item.maMon}>
                  <div className="pos-cart-item-top">
                    <div>
                      <strong>{item.tenMon}</strong>
                      <small>{item.maMon} · {item.donViTinh || 'Phần'}</small>
                    </div>
                    <button
                      className="pos-remove"
                      title="Xóa món"
                      aria-label={`Xóa ${item.tenMon}`}
                      onClick={() => removeMainDish(item.maMon)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>

                  <div className="pos-cart-item-bottom">
                    <span>Số lượng</span>
                    <div className="pos-qty">
                      <button
                        aria-label="Giảm số lượng"
                        onClick={() => changeMainQuantity(item.maMon, -1)}
                      >
                        <Minus size={14} />
                      </button>
                      <b>{item.quantity}</b>
                      <button
                        aria-label="Tăng số lượng"
                        onClick={() => changeMainQuantity(item.maMon, 1)}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="pos-extra-area">
                    <span className="pos-extra-title">Extra cho món này</span>

                    {extras.length ? (
                      <div className="pos-extra-picker">
                        <select
                          value={item.selectedExtra}
                          onChange={(e) => selectExtra(item.maMon, e.target.value)}
                        >
                          {extras.map((extra) => (
                            <option key={extra.maMon} value={extra.maMon}>
                              {extra.tenMon}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => addExtra(item.maMon)}
                          disabled={!item.selectedExtra}
                        >
                          <Plus size={14} /> Thêm
                        </button>
                      </div>
                    ) : (
                      <small>Chưa có Extra đang kinh doanh.</small>
                    )}

                    {item.extras.map((extra) => (
                      <div className="pos-extra-line" key={extra.maMon}>
                        <div>
                          <strong>{extra.tenMon}</strong>
                          <small>{extra.maMon} · {extra.quantity} phần / món chính</small>
                        </div>
                        <div className="pos-qty">
                          <button
                            aria-label="Giảm số lượng Extra"
                            onClick={() => changeExtraQuantity(item.maMon, extra.maMon, -1)}
                          >
                            <Minus size={12} />
                          </button>
                          <b>{extra.quantity}</b>
                          <button
                            aria-label="Tăng số lượng Extra"
                            onClick={() => changeExtraQuantity(item.maMon, extra.maMon, 1)}
                          >
                            <Plus size={12} />
                          </button>
                          <button
                            className="pos-remove"
                            title="Xóa Extra"
                            aria-label={`Xóa ${extra.tenMon}`}
                            onClick={() => removeExtra(item.maMon, extra.maMon)}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              ))
            ) : (
              <div className="pos-empty-cart">
                <span><ShoppingBag size={23} /></span>
                <strong>Chưa có món nào</strong>
                <small>Chọn món từ danh sách để bắt đầu hóa đơn.</small>
              </div>
            )}
          </div>

          <div className="pos-cart-footer">
            <div className="pos-no-price">
              <span>Tổng tiền</span>
              <strong>Không áp dụng</strong>
            </div>
            <p>
              {itemCount} món chính · {extraCount} phần Extra
            </p>
            <p>Hệ thống không quản lý giá bán hoặc doanh thu.</p>

            {checkoutError && (
              <div className="pos-checkout-error" role="alert">
                <AlertCircle size={16} />
                <span>{checkoutError}</span>
              </div>
            )}

            <button
              className="pos-checkout"
              disabled={!cart.length || submitting}
              onClick={checkout}
            >
              {submitting ? (
                <><span className="pos-spinner" /> Đang xử lý...</>
              ) : (
                <><Check size={17} /> Xác nhận thanh toán</>
              )}
            </button>
            <small className="pos-checkout-note">
              Xác nhận sẽ gửi hóa đơn đến máy chủ và cập nhật tồn kho.
            </small>
          </div>
        </aside>
      </div>

      {invoice && (
        <div
          className="pos-overlay"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setInvoice(null)
          }}
        >
          <section
            className="pos-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pos-confirm-title"
          >
            <button
              className="pos-confirm-close"
              aria-label="Đóng"
              onClick={() => setInvoice(null)}
            >
              <X size={18} />
            </button>

            <span className="pos-confirm-icon"><Check size={25} /></span>
            <span className="pos-eyebrow">KẾT QUẢ THANH TOÁN</span>
            <h2 id="pos-confirm-title">
              {invoice.replayed ? 'Hóa đơn đã được xử lý' : 'Thanh toán thành công'}
            </h2>
            <p>{invoice.message}</p>

            <div className="pos-confirm-meta">
              <span>Mã hóa đơn</span>
              <strong>{invoice.maHoaDon}</strong>
              <span>Thời gian</span>
              <strong>{formatDate(invoice.thoiGian)}</strong>
              <span>Trạng thái</span>
              <strong className="pos-pending">Đã thanh toán</strong>
            </div>

            <div className="pos-confirm-lines">
              {invoice.items.map((item, index) => {
                const main = mainDishes.find((dish) => dish.maMon === item.maMon)
                return (
                  <div className="pos-confirm-order-line" key={`${item.maMon}-${index}`}>
                    <span>{main?.tenMon || item.maMon} × {item.soLuong}</span>
                    {item.extras.map((extra) => {
                      const extraInfo = extras.find((dish) => dish.maMon === extra.maMon)
                      return (
                        <small key={extra.maMon}>
                          + {extraInfo?.tenMon || extra.maMon} × {extra.soLuong} / món
                        </small>
                      )
                    })}
                  </div>
                )
              })}
            </div>

            <button className="pos-confirm-done" onClick={() => setInvoice(null)}>
              Hoàn tất
            </button>
          </section>
        </div>
      )}
    </main>
  )
}
