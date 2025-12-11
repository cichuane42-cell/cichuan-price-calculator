import React, { useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

type ProductTier = {
  min: number;
  unitPrice: number;
  leadTime: string;
  note?: string;
};

type Product = {
  id: string;
  label: string;
  description?: string;
  minQty: number;
  tiers: ProductTier[];
};

const PRODUCTS: Record<string, Product> = {
  headcard100: {
    id: "headcard100",
    label: "100公克米包＋專用頭卡",
    description: "適合婚禮小物、企業活動小禮，單入小包設計。",
    minQty: 40,
    tiers: [
      { min: 40, unitPrice: 28, leadTime: "7–10 個工作天", note: "少量客製" },
      { min: 100, unitPrice: 24, leadTime: "10–14 個工作天" },
      { min: 300, unitPrice: 22, leadTime: "14–20 個工作天", note: "大量優惠" },
    ],
  },
  headcard150: {
    id: "headcard150",
    label: "150公克米包＋專用頭卡",
    description: "份量更飽滿的客製小物，適合作為活動或開幕贈品。",
    minQty: 40,
    tiers: [
      { min: 40, unitPrice: 32, leadTime: "7–10 個工作天" },
      { min: 100, unitPrice: 29, leadTime: "10–14 個工作天" },
      { min: 300, unitPrice: 27, leadTime: "14–20 個工作天" },
    ],
  },
  giftbox2: {
    id: "giftbox2",
    label: "雙入米禮盒（300g×2）",
    description: "適合過年、節慶送禮，附提袋。",
    minQty: 20,
    tiers: [
      { min: 20, unitPrice: 260, leadTime: "10–14 個工作天" },
      { min: 80, unitPrice: 240, leadTime: "14–20 個工作天" },
      { min: 200, unitPrice: 230, leadTime: "20–25 個工作天" },
    ],
  },
};

const formatCurrency = (value: number) =>
  value.toLocaleString("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  });

const App: React.FC = () => {
  const [selectedProductId, setSelectedProductId] = useState<string>("headcard100");
  const [qty, setQty] = useState<number>(100);
  const [customerName, setCustomerName] = useState<string>("");
  const [note, setNote] = useState<string>("");

  const quoteRef = useRef<HTMLDivElement | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const product = useMemo(
    () => PRODUCTS[selectedProductId],
    [selectedProductId]
  );

  const currentTier = useMemo(() => {
    const tiers = product.tiers.sort((a, b) => a.min - b.min);
    let tier = tiers[0];
    for (const t of tiers) {
      if (qty >= t.min) tier = t;
    }
    return tier;
  }, [product, qty]);

  const unitPrice = currentTier.unitPrice;
  const totalPrice = unitPrice * (isNaN(qty) ? 0 : qty);

  const handleQtyChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const v = parseInt(e.target.value, 10);
    if (isNaN(v)) {
      setQty(product.minQty);
    } else {
      setQty(v < product.minQty ? product.minQty : v);
    }
  };

  const handleDownloadPdf = async () => {
    if (!quoteRef.current) return;
    try {
      setIsExporting(true);
      const element = quoteRef.current;

      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        scrollX: 0,
        scrollY: 0,
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let position = 0;
      let heightLeft = imgHeight;

      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      const dateStr = new Date().toISOString().slice(0, 10);
      const fileName = customerName
        ? `西川米店_客製報價_${customerName}_${dateStr}.pdf`
        : `西川米店_客製報價_${dateStr}.pdf`;

      pdf.save(fileName);
    } catch (error) {
      console.error("PDF 下載失敗：", error);
      alert("下載 PDF 時發生錯誤，請再試一次。");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-6xl grid gap-6 lg:grid-cols-[1.15fr,1fr]">
        {/* 左側：操作區 */}
        <div className="bg-white rounded-2xl shadow-md p-6 lg:p-8">
          <header className="flex flex-col gap-2 mb-6 border-b border-slate-200 pb-4">
            <h1 className="text-2xl lg:text-3xl font-bold text-slate-900">
              西川米店｜客製化即時計算器
            </h1>
            <p className="text-sm text-slate-500">
              適用於客製米小物、禮盒報價的快速估價工具，可立即看到單價與總金額，並下載成 PDF 報價單。
            </p>
          </header>

          <section className="space-y-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                客戶名稱或專案名稱（選填）
              </label>
              <input
                type="text"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                placeholder="例如：〇〇婚禮小物、××公司尾牙禮"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                商品項目
              </label>
              <select
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
              >
                {Object.values(PRODUCTS).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              {product.description && (
                <p className="mt-1 text-xs text-slate-500">
                  {product.description}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  客製數量（最少 {product.minQty} 份）
                </label>
                <input
                  type="number"
                  min={product.minQty}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                  value={qty}
                  onChange={handleQtyChange}
                />
                <p className="mt-1 text-xs text-slate-500">
                  目前套用：滿 {currentTier.min} 份以上的階梯單價。
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  預估單價（自動帶入，可再微調）
                </label>
                <input
                  type="number"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                  value={unitPrice}
                  onChange={(e) =>
                    (currentTier.unitPrice = Number(e.target.value) || unitPrice)
                  }
                />
                <p className="mt-1 text-xs text-slate-500">
                  單價可依實際談價微調，PDF 會以此金額為主。
                </p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                備註說明（選填）
              </label>
              <textarea
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent min-h-[72px]"
                placeholder="例如：指定米種、包裝客製內容、運費條件、是否分點配送⋯⋯"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </section>

          <section className="border-t border-slate-200 pt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              <div className="text-slate-600">
                預估總金額：
                <span className="font-semibold text-amber-600 text-lg ml-1">
                  {formatCurrency(totalPrice)}
                </span>
              </div>
              <div className="text-xs text-slate-500 mt-1">
                僅為試算金額，實際報價仍以西川米店正式報價單為準。
              </div>
            </div>
            <button
              onClick={handleDownloadPdf}
              disabled={isExporting}
              className="inline-flex items-center justify-center rounded-full bg-amber-500 hover:bg-amber-600 disabled:opacity-60 disabled:cursor-not-allowed px-5 py-2 text-sm font-medium text-white transition-colors"
            >
              {isExporting ? "產生中⋯⋯" : "下載 PDF 報價單"}
            </button>
          </section>
        </div>

        {/* 右側：PDF 預覽區（由 html2canvas 擷取） */}
        <div className="bg-slate-50 rounded-2xl border border-dashed border-amber-200 p-4 lg:p-6">
          <p className="text-xs text-slate-500 mb-2">
            下方區塊為 PDF 擷取範圍（A4 比例），可依需要微調樣式。
          </p>
          <div
            ref={quoteRef}
            className="bg-white shadow-sm rounded-xl px-6 py-6 text-[13px] text-slate-800 mx-auto"
            style={{ aspectRatio: "595 / 842", maxHeight: "720px", overflow: "hidden" }}
          >
            <header className="flex justify-between items-start border-b border-slate-200 pb-3 mb-4">
              <div>
                <h2 className="text-lg font-bold tracking-wide">
                  西川米店 客製化報價單
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  TEL｜04-2273-5306　地址｜臺中市太平區中山路二段410號
                </p>
              </div>
              <div className="text-right text-xs text-slate-500">
                <div>報價日期：{new Date().toISOString().slice(0, 10)}</div>
                {customerName && <div>客戶／專案：{customerName}</div>}
              </div>
            </header>

            <section className="mb-4">
              <table className="w-full border border-slate-200 border-collapse text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="border border-slate-200 px-2 py-1 text-left">
                      品項
                    </th>
                    <th className="border border-slate-200 px-2 py-1 text-right">
                      數量
                    </th>
                    <th className="border border-slate-200 px-2 py-1 text-right">
                      單價 (元)
                    </th>
                    <th className="border border-slate-200 px-2 py-1 text-right">
                      小計 (元)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-slate-200 px-2 py-1 align-top">
                      <div className="font-medium">{product.label}</div>
                      {product.description && (
                        <div className="text-[11px] text-slate-500">
                          {product.description}
                        </div>
                      )}
                      <div className="text-[11px] text-slate-500 mt-1">
                        交期估計：{currentTier.leadTime}
                        {currentTier.note ? `（${currentTier.note}）` : ""}
                      </div>
                    </td>
                    <td className="border border-slate-200 px-2 py-1 text-right align-top">
                      {qty.toLocaleString()}
                    </td>
                    <td className="border border-slate-200 px-2 py-1 text-right align-top">
                      {unitPrice.toLocaleString()}
                    </td>
                    <td className="border border-slate-200 px-2 py-1 text-right align-top">
                      {totalPrice.toLocaleString()}
                    </td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr className="bg-amber-50">
                    <td
                      className="border border-slate-200 px-2 py-1 text-right font-semibold"
                      colSpan={3}
                    >
                      預估總計
                    </td>
                    <td className="border border-slate-200 px-2 py-1 text-right font-semibold">
                      {totalPrice.toLocaleString()} 元
                    </td>
                  </tr>
                </tfoot>
              </table>
            </section>

            {note && (
              <section className="mb-3">
                <h3 className="text-xs font-semibold mb-1">備註說明</h3>
                <p className="border border-slate-200 rounded px-2 py-2 text-[11px] leading-relaxed whitespace-pre-wrap">
                  {note}
                </p>
              </section>
            )}

            <section className="mt-auto">
              <h3 className="text-xs font-semibold mb-1">報價說明</h3>
              <ol className="text-[11px] text-slate-500 list-decimal list-inside space-y-1 leading-snug">
                <li>本報價為預估金額，詳細內容與稅額以正式報價單及訂購單為準。</li>
                <li>實際交期需依當下排程與檔期量能確認，如有急件需求請先來電洽詢。</li>
                <li>報價未含特殊客製設計費（如插畫設計、Logo 重繪等），如有需要可另行估價。</li>
                <li>運費與分點配送條件，依配送地點與箱數另行報價。</li>
              </ol>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
