import React, { useMemo, useState, useRef } from "react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

// 後台紀錄用的 Google Apps Script Endpoint（寫入 Google Sheet）
const GOOGLE_SHEET_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbzcvN_S7G8n_jwNIBOHKvRDVAXfwWiVWHaAt3DcVGyqWtQ-afKj3trDWKZsPw9P7pI/exec";

// 客製價目表設定
const PRODUCTS = {
  headcard100: {
    id: "headcard100",
    label: "100公克米包+專用頭卡",
    minQty: 40,
    tiers: [
      { min: 500, unitPrice: 4, leadDays: 5 },
      { min: 250, unitPrice: 5, leadDays: 5 },
      { min: 40, unitPrice: 6, leadDays: 2 },
    ],
  },
  band300: {
    id: "band300",
    label: "300公克米包+專用腰封",
    minQty: 30,
    tiers: [
      { min: 1000, unitPrice: 4, leadDays: 5 },
      { min: 500, unitPrice: 5, leadDays: 5 },
      { min: 30, unitPrice: 8, leadDays: 2 },
    ],
  },
  pack500: {
    id: "pack500",
    label: "500公克米包+專用腰封",
    minQty: 40,
    tiers: [
      { min: 6000, unitPrice: 6, leadDays: 5 },
      { min: 2000, unitPrice: 7, leadDays: 5 },
      { min: 40, unitPrice: 10, leadDays: 2 },
    ],
  },
} as const;

type ProductKey = keyof typeof PRODUCTS;
type Product = (typeof PRODUCTS)[ProductKey];

function calcTier(product: Product, qty: number) {
  if (!qty || qty < product.minQty) return null;
  const tier = [...product.tiers]
    .sort((a, b) => b.min - a.min)
    .find((t) => qty >= t.min);
  return tier || null;
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(n);
}

function classNames(...cls: (string | false | null | undefined)[]) {
  return cls.filter(Boolean).join(" ");
}

interface LineItem {
  id: string;
  productKey: ProductKey;
  qty: number; // 來檔客製數量（張） - 自動計算
  riceQty: number; // 米包數量（包） - >=1
  rush: boolean; // 是否 5 天快速出貨
}

interface CustomerInfo {
  name: string; // 公司名稱 / 新人姓名
  phone: string;
  email: string;
  line: string;
  scenario: string; // 使用情境
  note: string; // ✅新增：備註（選填）
  wantContact: boolean; // 是否勾選「我想要客服聯繫我」
}

const App: React.FC = () => {
  const [items, setItems] = useState<LineItem[]>([
    {
      id: crypto.randomUUID(),
      productKey: "headcard100",
      qty: PRODUCTS.headcard100.minQty,
      riceQty: PRODUCTS.headcard100.minQty,
      rush: false,
    },
  ]);

  const [customer, setCustomer] = useState<CustomerInfo>({
    name: "",
    phone: "",
    email: "",
    line: "",
    scenario: "",
    note: "", // ✅新增
    wantContact: false,
  });

  // 原本包住整個畫面的 ref（保留）
  const containerRef = useRef<HTMLDivElement | null>(null);

  // ✅ 新增：專門給 PDF 用的隱藏報價單版面
  const pdfRef = useRef<HTMLDivElement | null>(null);

  // 依米包數量與品項，計算「客製數量（張）」：至少為該品項 minQty
  function computeCustomQty(product: Product, riceQty: number): number {
    const safeRice = Number.isFinite(riceQty)
      ? Math.max(1, Math.floor(riceQty))
      : 1;
    return Math.max(product.minQty, safeRice);
  }

  const summary = useMemo(() => {
    let subtotal = 0;
    let riceSubtotalTotal = 0;
    let packSubtotalTotal = 0;
    let maxLeadDays: number | null = null;
    let allRushTrue = true;
    let allRushFalse = true;

    const rows = items.map((it) => {
      const product = PRODUCTS[it.productKey];
      const riceQty = Math.max(1, Math.floor(it.riceQty));
      const qty = computeCustomQty(product, riceQty);
      const rush = items[0]?.rush ?? false;

      const tier = calcTier(product, qty);
      const valid = !!tier;

      const baseUnit = tier?.unitPrice ?? 0; // 客製單價
      const leadDays = tier?.leadDays ?? null;

      const baseRiceUnit =
        product.id === "headcard100"
          ? 29
          : product.id === "band300"
          ? 49
          : 240;

      const riceUnit = rush
        ? product.id === "headcard100"
          ? 35
          : product.id === "band300"
          ? 59
          : 270
        : baseRiceUnit;

      const riceSubtotal = riceQty * riceUnit;
      const packSubtotal = valid ? qty * baseUnit : 0;
      const lineTotal = riceSubtotal + packSubtotal;

      subtotal += lineTotal;
      riceSubtotalTotal += riceSubtotal;
      packSubtotalTotal += packSubtotal;

      if (leadDays != null) {
        maxLeadDays =
          maxLeadDays == null ? leadDays : Math.max(maxLeadDays, leadDays);
      }

      if (rush) {
        allRushFalse = false;
      } else {
        allRushTrue = false;
      }

      return {
        id: it.id,
        name: product.label,
        qty,
        riceQty,
        baseUnit,
        riceUnit,
        riceSubtotal,
        packSubtotal,
        lineTotal,
        valid,
        rush,
        leadDays,
        product,
      };
    });

    const tax = 0;
    const total = subtotal + tax;

    const riceDays =
      rows.length === 0 ? null : allRushTrue ? 5 : allRushFalse ? 10 : null;

    return {
      rows,
      subtotal,
      tax,
      total,
      riceSubtotalTotal,
      packSubtotalTotal,
      riceDays,
      maxLeadDays,
    };
  }, [items]);

  function updateItem(id: string, patch: Partial<LineItem>) {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const next: LineItem = { ...it, ...patch };
        const product = PRODUCTS[next.productKey];
        const fixedRice = Math.max(1, Math.floor(next.riceQty));
        const nextQty = computeCustomQty(product, fixedRice);
        return { ...next, riceQty: fixedRice, qty: nextQty };
      })
    );
  }

  function addItem() {
    setItems((prev) => {
      const baseRush = prev[0]?.rush ?? false;
      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          productKey: "headcard100",
          qty: PRODUCTS.headcard100.minQty,
          riceQty: PRODUCTS.headcard100.minQty,
          rush: baseRush,
        },
      ];
    });
  }

  function removeItem(id: string) {
    setItems((prev) =>
      prev.length <= 1 ? prev : prev.filter((it) => it.id !== id)
    );
  }

  function resetAll() {
    setItems([
      {
        id: crypto.randomUUID(),
        productKey: "headcard100",
        qty: PRODUCTS.headcard100.minQty,
        riceQty: PRODUCTS.headcard100.minQty,
        rush: false,
      },
    ]);
    setCustomer({
      name: "",
      phone: "",
      email: "",
      line: "",
      scenario: "",
      note: "", // ✅新增
      wantContact: false,
    });
  }

  // 報價單日期與編號
  const now = new Date();
  const dateStr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(
    2,
    "0"
  )}/${String(now.getDate()).padStart(2, "0")}`;
  const quoteNo =
    `${now.getFullYear()}` +
    `${String(now.getMonth() + 1).padStart(2, "0")}` +
    `${String(now.getDate()).padStart(2, "0")}` +
    `-${String(now.getHours()).padStart(2, "0")}` +
    `${String(now.getMinutes()).padStart(2, "0")}`;

  // 將報價紀錄寫入 Google Sheet（透過 Apps Script）
  async function sendToGoogleSheet() {
    if (!GOOGLE_SHEET_ENDPOINT) return;

    if (typeof fetch !== "function") {
      return;
    }

    const payload = {
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      line: customer.line,
      scenario: customer.scenario,
      note: customer.note, // ✅新增
      wantContact: customer.wantContact,
      total: summary.total,
      items: summary.rows.map((r) => ({
        name: r.name,
        riceQty: r.riceQty,
        riceUnit: r.riceUnit,
        riceSubtotal: r.riceSubtotal,
        customQty: r.qty,
        customUnit: r.baseUnit,
        customSubtotal: r.packSubtotal,
        lineTotal: r.lineTotal,
        riceDays: summary.riceDays,
        customDays: summary.maxLeadDays,
      })),
    };

    try {
      const res = await fetch(GOOGLE_SHEET_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn("送到 Google Sheet 失敗：HTTP " + res.status, text);
      }
    } catch (err) {
      console.warn("送到 Google Sheet 失敗（網路或權限問題）", err);
    }
  }

  // ✅ 使用 html2canvas 擷取「隱藏 A4 報價單版面」，轉成 PDF（滿版 A4）
  async function downloadPdf() {
    if (!customer.name || !customer.phone) {
      window.alert("請先填寫「公司名稱 / 新人姓名」與「連絡電話」。");
      return;
    }

    void sendToGoogleSheet();

    const element = pdfRef.current;
    if (!element) {
      window.alert("找不到報價單版面，請重新整理頁面再試一次。");
      return;
    }

    // A4@96dpi 近似：794 x 1123
    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      width: 794,
      height: 1123,
    });

    const imgData = canvas.toDataURL("image/png");

    const pdf = new jsPDF("p", "mm", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    // ✅ 直接滿版填滿 A4
    pdf.addImage(imgData, "PNG", 0, 0, pageWidth, pageHeight);

    pdf.save(`西川米店_報價單_${dateStr}.pdf`);
  }

  return (
    <div className="min-h-screen w-full bg-gray-50 py-10 px-4">
      <div className="mx-auto max-w-4xl" ref={containerRef}>
        <header className="mb-6 text-center">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            西川米店｜客製化即時報價計算器
          </h1>
          <p className="text-gray-600 mt-2">
            輸入米包數量，即時計算米包與客製加工費用，並顯示製作天數與預估小計。
          </p>
        </header>

        <div className="bg-white rounded-2xl shadow p-4 md:p-6 space-y-4">
          {/* 基本資料區 */}
          <section className="border rounded-2xl p-4 bg-gray-50/80 space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">基本資料</h2>
              <p className="text-[11px] text-red-500">＊為必填欄位</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  <span className="text-red-500 mr-0.5">＊</span>
                  公司名稱 / 新人姓名
                </label>
                <input
                  type="text"
                  className="w-full rounded-xl border px-3 py-2 text-sm"
                  placeholder="例：西川米店／賴ＯＯ＆高ＯＯ"
                  value={customer.name}
                  onChange={(e) =>
                    setCustomer((prev) => ({ ...prev, name: e.target.value }))
                  }
                />
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  <span className="text-red-500 mr-0.5">＊</span>
                  連絡電話
                </label>
                <input
                  type="tel"
                  className="w-full rounded-xl border px-3 py-2 text-sm"
                  placeholder="例：09xx-xxx-xxx"
                  value={customer.phone}
                  onChange={(e) =>
                    setCustomer((prev) => ({ ...prev, phone: e.target.value }))
                  }
                />
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-1">Email</label>
                <input
                  type="email"
                  className="w-full rounded-xl border px-3 py-2 text-sm"
                  placeholder="例：name@example.com"
                  value={customer.email}
                  onChange={(e) =>
                    setCustomer((prev) => ({ ...prev, email: e.target.value }))
                  }
                />
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-1">LINE</label>
                <input
                  type="text"
                  className="w-full rounded-xl border px-3 py-2 text-sm"
                  placeholder="例：LINE ID 或 顯示名稱"
                  value={customer.line}
                  onChange={(e) =>
                    setCustomer((prev) => ({ ...prev, line: e.target.value }))
                  }
                />
              </div>

              {/* ✅ 使用情境 */}
              <div>
                <label className="block text-xs text-gray-600 mb-1">使用情境</label>
                <select
                  className="w-full rounded-xl border px-3 py-2 bg-white text-sm"
                  value={customer.scenario}
                  onChange={(e) =>
                    setCustomer((prev) => ({ ...prev, scenario: e.target.value }))
                  }
                >
                  <option value="">請選擇</option>
                  <option value="婚禮">婚禮</option>
                  <option value="春節企業送禮">春節企業送禮</option>
                  <option value="彌月">彌月</option>
                  <option value="尾牙">尾牙</option>
                  <option value="活動">活動</option>
                  <option value="其他">其他</option>
                </select>
              </div>

              {/* ✅ 備註（選填） */}
              <div>
                <label className="block text-xs text-gray-600 mb-1">備註（選填）</label>
                <input
                  type="text"
                  className="w-full rounded-xl border px-3 py-2 text-sm"
                  placeholder="例：希望 12/25 前到貨、要分點配送…"
                  value={customer.note}
                  onChange={(e) =>
                    setCustomer((prev) => ({ ...prev, note: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="pt-1">
              <label className="inline-flex items-center text-xs text-gray-700">
                <input
                  type="checkbox"
                  className="rounded border-gray-300"
                  checked={customer.wantContact}
                  onChange={(e) =>
                    setCustomer((prev) => ({
                      ...prev,
                      wantContact: e.target.checked,
                    }))
                  }
                />
                <span className="ml-2">我想要客服聯繫我</span>
              </label>
            </div>
          </section>

          {/* 操作按鈕列 */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                onClick={addItem}
                className="px-3 py-2 rounded-xl bg-black text-white text-sm hover:opacity-90"
              >
                新增品項
              </button>
              <button
                onClick={resetAll}
                className="px-3 py-2 rounded-xl border text-sm hover:bg-gray-50"
              >
                重設
              </button>
            </div>
            <button
              onClick={downloadPdf}
              className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm hover:bg-emerald-700"
            >
              下載 PDF 報價單
            </button>
          </div>

          {/* 品項列表 */}
          <div className="space-y-3">
            {items.map((it, index) => {
              const product = PRODUCTS[it.productKey];
              const row = summary.rows.find((r) => r.id === it.id);
              const rush = items[0]?.rush ?? false;

              const riceUnit = row?.riceUnit ?? 0;
              const riceSubtotal = row?.riceSubtotal ?? 0;
              const customUnit = row?.baseUnit ?? 0;
              const customSubtotal = row?.packSubtotal ?? 0;
              const valid = row?.valid ?? false;

              return (
                <div
                  key={it.id}
                  className="rounded-2xl border p-4 md:p-5 bg-gray-50/60"
                >
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-4 items-start">
                    {/* 左側：品項與數量 */}
                    <div className="md:col-span-7 space-y-3">
                      {/* 品項選擇 */}
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">
                          品項
                        </label>
                        <select
                          className="w-full rounded-xl border px-3 py-2 bg-white text-sm"
                          value={it.productKey}
                          onChange={(e) => {
                            const key = e.target.value as ProductKey;
                            const nextProduct = PRODUCTS[key];
                            const nextRice = nextProduct.minQty;
                            const nextQty = computeCustomQty(nextProduct, nextRice);
                            updateItem(it.id, {
                              productKey: key,
                              riceQty: nextRice,
                              qty: nextQty,
                            });
                          }}
                        >
                          {(Object.keys(PRODUCTS) as ProductKey[]).map((k) => (
                            <option key={k} value={k}>
                              {PRODUCTS[k].label}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* 米包數量輸入 */}
                      <div className="flex items-end gap-3">
                        <div className="flex-1">
                          <label className="block text-sm text-gray-600 mb-1">
                            米包數量（包）
                          </label>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            className={classNames(
                              "w-full rounded-xl border px-3 py-2 bg-white",
                              !valid && "border-red-400 focus:border-red-500"
                            )}
                            value={it.riceQty}
                            onChange={(e) => {
                              const v = e.target.value;
                              const raw = Number(v);
                              if (!Number.isFinite(raw)) {
                                updateItem(it.id, { riceQty: 1 });
                              } else {
                                const fixed = Math.max(1, Math.floor(raw));
                                updateItem(it.id, { riceQty: fixed });
                              }
                            }}
                          />
                        </div>
                        <div className="w-32 text-xs text-gray-600 text-left space-y-1 flex flex-col justify-end">
                          <div>{`米包單價：NT$${riceUnit}／包`}</div>
                          <div>米包小計：{formatCurrency(riceSubtotal)}</div>
                        </div>
                      </div>

                      {/* 來檔客製數量（只顯示，不可修改） */}
                      <div className="flex flex-col gap-1">
                        <div className="flex items-end gap-3">
                          <div className="flex-1">
                            <label className="block text-sm text-gray-600 mb-1">
                              來檔客製數量（張）
                            </label>
                            <input
                              type="number"
                              className="w-full rounded-xl border px-3 py-2 bg-gray-100 text-gray-500"
                              value={row?.qty ?? it.qty}
                              disabled
                              readOnly
                            />
                          </div>
                          <div className="w-32 text-xs text-gray-600 text-left space-y-1 flex flex-col justify-end">
                            <div>
                              客製單價：
                              {valid ? `NT$${customUnit}／張` : "—"}
                            </div>
                            <div>
                              客製小計：
                              {valid ? formatCurrency(customSubtotal) : "—"}
                            </div>
                          </div>
                        </div>
                        {!valid && (
                          <p className="text-xs text-red-600 mt-1">
                            最低起印 {product.minQty} 張
                          </p>
                        )}
                        <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                          {product.id === "headcard100" && (
                            <>
                              <div>500 張以上 → NT$4</div>
                              <div>250–499 張 → NT$5</div>
                              <div>40–249 張 → NT$6</div>
                              <div>未滿 40 張以 40 張計算</div>
                            </>
                          )}
                          {product.id === "band300" && (
                            <>
                              <div>1000 張以上 → NT$4</div>
                              <div>500–999 張 → NT$5</div>
                              <div>30–499 張 → NT$8</div>
                              <div>未滿 30 張以 30 張計算</div>
                            </>
                          )}
                          {product.id === "pack500" && (
                            <>
                              <div>6000 張以上 → NT$6</div>
                              <div>2000–5999 張 → NT$7</div>
                              <div>40–1999 張 → NT$10</div>
                              <div>未滿 40 張以 40 張計算</div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 右側：製作天數 & 刪除 */}
                    <div className="md:col-span-5 flex flex-col gap-2 items-end justify-between h-full">
                      {index === 0 && (
                        <div className="w-full md:w-auto text-right md:text-left">
                          <label className="block text-sm text-gray-600 mb-1">
                            製作天數（米包）
                          </label>
                          <div className="flex gap-2 justify-end md:justify-start">
                            <button
                              type="button"
                              className={classNames(
                                "px-3 py-1 rounded-full border text-xs",
                                !rush
                                  ? "bg-black text-white border-black"
                                  : "bg-white text-gray-700"
                              )}
                              onClick={() => {
                                setItems((prev) =>
                                  prev.map((rowItem) => ({
                                    ...rowItem,
                                    rush: false,
                                  }))
                                );
                              }}
                            >
                              10 天
                            </button>
                            <button
                              type="button"
                              className={classNames(
                                "px-3 py-1 rounded-full border text-xs",
                                rush
                                  ? "bg-black text-white border-black"
                                  : "bg-white text-gray-700"
                              )}
                              onClick={() => {
                                setItems((prev) =>
                                  prev.map((rowItem) => ({
                                    ...rowItem,
                                    rush: true,
                                  }))
                                );
                              }}
                            >
                              5 天
                            </button>
                          </div>
                          <p className="text-xs text-gray-500 mt-1 text-right md:text-left">
                            10天：100g NT$29/包、300g NT$49/包、500g NT$240/包。
                            <br />
                            5天：100g NT$35/包、300g NT$59/包、500g NT$270/包。
                          </p>
                        </div>
                      )}

                      {items.length > 1 && (
                        <button
                          onClick={() => removeItem(it.id)}
                          className="text-xs text-gray-500 hover:text-red-600"
                        >
                          刪除此品項
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 訂單試算區 */}
          <div className="mt-6 border-t pt-4">
            <h3 className="font-semibold mb-3">訂單試算</h3>
            <div className="overflow-auto rounded-xl border">
              <table className="min-w-full text-sm table-fixed">
                <colgroup>
                  <col className="w-[220px]" />
                  <col className="w-[110px]" />
                  <col className="w-[110px]" />
                  <col className="w-[120px]" />
                  <col className="w-[120px]" />
                  <col className="w-[110px]" />
                  <col className="w-[120px]" />
                  <col className="w-[150px]" />
                </colgroup>
                <thead className="bg-gray-100">
                  <tr>
                    <th className="text-left px-3 py-2">品項</th>
                    <th className="text-right px-3 py-2">米包數量</th>
                    <th className="text-right px-3 py-2">米包單價</th>
                    <th className="text-right px-3 py-2">米包小計</th>
                    <th className="text-right px-3 py-2">客製數量（張）</th>
                    <th className="text-right px-3 py-2">客製單價</th>
                    <th className="text-right px-3 py-2">客製小計</th>
                    <th className="text-right px-3 py-2">小計</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.rows.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="px-3 py-2">{r.name}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.riceQty}</td>
                      <td className="px-3 py-2 text-right font-mono">NT${r.riceUnit}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {formatCurrency(r.riceSubtotal)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{r.qty}</td>
                      <td className="px-3 py-2 text-right font-mono">NT${r.baseUnit}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {formatCurrency(r.packSubtotal)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-medium">
                        {formatCurrency(r.lineTotal)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 border-t">
                    <td className="px-3 py-2 font-medium">合計</td>
                    <td className="px-3 py-2" colSpan={6}></td>
                    <td className="px-3 py-2 text-right font-bold text-base">
                      {formatCurrency(summary.total)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="text-xs text-gray-500 mt-3 space-y-1">
              <p>＊交期以「完稿確認」後起算；急件請先與客服確認產能與時程。</p>
              <p>＊運費、設計排版服務費另計（如需）。</p>
              <p>＊本試算為預估金額，實際金額以客服/報價單為主。</p>
            </div>
          </div>
        </div>

        <footer className="text-center text-xs text-gray-500 mt-6">
          西川米店 © {new Date().getFullYear()} — 客製印刷 / 企業大量訂購歡迎洽詢
        </footer>
      </div>

      {/* ✅ 隱藏版 A4 PDF 報價單版面（畫面看不到，PDF 會截這一塊） */}
      <div
        ref={pdfRef}
        className="fixed left-[-10000px] top-0 bg-white text-gray-800"
        style={{
          width: "794px",
          height: "1123px",
          padding: "40px",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            border: "1px solid #d1d5db",
            padding: "28px",
            boxSizing: "border-box",
          }}
        >
          {/* Logo + 標題 + 編號日期 */}
          <div className="flex justify-between items-start mb-4">
            <div className="flex items-start gap-3">
              <img
                src="/cichuan-logo.png"
                alt="西川米店"
                style={{ height: 36, width: "auto" }}
              />
              <div>
                <div className="text-base font-bold">西川米店 報價單</div>
              </div>
            </div>

            <div className="text-[10px] leading-relaxed text-right">
              <div>報價單編號：{quoteNo}</div>
              <div>日期：{dateStr}</div>
            </div>
          </div>

          {/* SERVICE PROVIDER / CUSTOMER */}
          <div className="flex justify-between mb-6 text-[10px]">
            <div className="w-1/2 pr-4">
              <div className="font-semibold mb-1">SERVICE PROVIDER</div>
              <div>西川米店</div>
              <div>聯絡人：西川客服</div>
              <div>電話：04-3700-7900</div>
              <div>Email：cichuan118@gmail.com</div>
              <div>地址：408臺中市南屯區東興路一段468號</div>
            </div>
            <div className="w-1/2">
              <div className="font-semibold mb-1">CUSTOMER</div>
              {customer.name && <div>公司 / 姓名：{customer.name}</div>}
              {customer.phone && <div>聯絡電話：{customer.phone}</div>}
              {customer.email && <div>Email：{customer.email}</div>}
              {customer.line && <div>LINE：{customer.line}</div>}
              {customer.scenario && <div>使用情境：{customer.scenario}</div>}
              {customer.note && <div>備註：{customer.note}</div>}
            </div>
          </div>

          {/* 明細表格 */}
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="bg-gray-100">
                <th className="border px-1 py-1 text-left">品項</th>
                <th className="border px-1 py-1 text-right">米包數量</th>
                <th className="border px-1 py-1 text-right">米包單價</th>
                <th className="border px-1 py-1 text-right">米包小計</th>
                <th className="border px-1 py-1 text-right">客製數量（張）</th>
                <th className="border px-1 py-1 text-right">客製單價</th>
                <th className="border px-1 py-1 text-right">客製小計</th>
                <th className="border px-1 py-1 text-right">小計</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((r) => (
                <tr key={r.id}>
                  <td className="border px-1 py-1">{r.name}</td>
                  <td className="border px-1 py-1 text-right">{r.riceQty}</td>
                  <td className="border px-1 py-1 text-right">
                    NT${r.riceUnit}
                  </td>
                  <td className="border px-1 py-1 text-right">
                    {formatCurrency(r.riceSubtotal)}
                  </td>
                  <td className="border px-1 py-1 text-right">{r.qty}</td>
                  <td className="border px-1 py-1 text-right">
                    NT${r.baseUnit}
                  </td>
                  <td className="border px-1 py-1 text-right">
                    {formatCurrency(r.packSubtotal)}
                  </td>
                  <td className="border px-1 py-1 text-right">
                    {formatCurrency(r.lineTotal)}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="border px-1 py-1 font-semibold" colSpan={7}>
                  合計
                </td>
                <td className="border px-1 py-1 text-right font-bold">
                  {formatCurrency(summary.total)}
                </td>
              </tr>
            </tbody>
          </table>

          {/* 注意事項 */}
          <div className="mt-6 text-[9px] leading-relaxed">
            <div className="font-semibold mb-1">注意事項：</div>
            <div>
              米包製作天數：
              {summary.riceDays ? `${summary.riceDays} 天` : "依實際排程"}
            </div>
            <div>
              來檔客製製作天數：
              {summary.maxLeadDays ? `${summary.maxLeadDays} 天` : "依實際排程"}
            </div>
            <div>
              ＊交期以「完稿確認」後起算；急件請先與客服確認產能與時程。
            </div>
            <div>＊運費、設計排版服務費另計（如需）。</div>
            <div>
              ＊本試算為預估金額，實際金額以客服 / 報價單為主。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
