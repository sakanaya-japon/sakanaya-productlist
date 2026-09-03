// 1. CONFIG & STATE
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwgE8fOWPyXkr2WTZNIvH5G30ptWzQIK6DCO7kVK9x4b6RgSlHBY2wgmNwc42aA_WUOKA/exec'; // 2026-07-06 新ブック移行：新GASの/execに切替
const TELEGRAM_API_URL = 'https://telegram-bot-729928920450.asia-northeast1.run.app/';
const TELEGRAM_LINK = 'https://t.me/SAKANAYAJAPON';

let currentLang = (navigator.language || navigator.userLanguage || 'ja').startsWith('ja') ? 'jp' : 'en';
let currentCategory = 'ALL';
let allProducts = [];
let cart = {};
let currentClientOrderId = ''; // send_order の冪等キー（確認モーダルで採番→成功で破棄・設計§5-1）
let lastFiltered = []; // 直近の絞り込み結果（Excelダウンロード「表示中」用）
let catalogUpdateDate = ''; // カタログの更新日（ダウンロードファイル名用）

// 2. UI TEXT
const UI_TEXT = {
    jp: {
        cat_all: "全在庫商品", cat_kh: "🇰🇭 カンボジア産", cat_jp: "🇯🇵 日本産", origin_kh: "カンボジア産", origin_jp: "日本産", size_selectable: "サイズ選択可", noProducts: '該当商品なし', cat_frozen: "冷凍品",
        cat_fillet: "鮮魚フィレ・セミドレス・ドレス・ホール", cat_oil: "調味料・油", cat_kitchen: "厨房用品", cat_vege: "野菜", cat_waiting: "入荷待ち", inquiry: "問い合わせ",
        searchPlaceholder: "商品名で検索...", noticeTitle: "【お知らせ】クリック▲で詳細を閉じる",
        orderBarLabel: "📋 ご注文内容", orderNote: "* 最終的な数量・重量は納品時に確定いたします",
        exportCurrent: "⬇ 表示中をExcelへ", exportAll: "⬇ 全商品をExcelへ",
        clearBtn: 'クリア', recommendTitle: "🔥 本日のおすすめ", noProducts: '該当商品なし',
        stock: 'STOCK', stockLeft: '残り', size: 'サイズ', emptyCart: '商品が選択されていません。',
        weightCalc: '重量計算', qtyCalc: '数量計算', labelNotes: 'メモ',
        modalTitle: "新規登録",
        labelShop: "店名",
        labelStaff: "担当者名",
        labelPhone: "電話番号",
        btnCancel: "キャンセル",
        btnRegister: "登録",
        btnFirstOrder: "初めての方", btnRepeatOrder: "ご注文",
        btnSubmitFirst: "登録案内を受け取る", btnSubmitRepeat: "注文する",
                noticeBody:`・初めてのご注文の際には、必ず「初めての方」のボタンからご登録お願い致します。<br>・写真をクリックしていただきますと商品説明も見ていただけます。<br>・フィレからもご注文いただけますので、色々なお魚をぜひお試しください。`,
    en: {
        cat_all: "ALL of Stock", cat_kh: "🇰🇭 CAMBODIA", cat_jp: "🇯🇵 JAPAN", origin_kh: "CAMBODIA", origin_jp: "JAPAN", size_selectable: "Size Selection Available", noProducts: 'No products', cat_frozen: "FROZEN",
        cat_fillet: "FILLET/DR/SD/WHOLE", cat_oil: "OIL & SEASONING", cat_kitchen: "KITCHEN", cat_vege: "VEGETABLES", cat_waiting: "OUT OF STOCK", inquiry: "INQUIRY",
        searchPlaceholder: "Search...", noticeTitle: "【 NOTICE 】 Click for details",
        orderBarLabel: "📋 Your Order", orderNote: "* Final price confirmed upon delivery",
        exportCurrent: "⬇ This view to Excel", exportAll: "⬇ All items to Excel",
        clearBtn: 'Clear', recommendTitle: "🔥 Recommendation", noProducts: 'No products',
        stock: 'STOCK', stockLeft: 'Stock ', size: 'Size', emptyCart: 'Cart is empty.',
        weightCalc: 'Weight', qtyCalc: 'Quantity', labelNotes: 'Notes',
        modalTitle: "Registration",
        labelShop: "Shop Name",
        labelStaff: "Contact Person",
        labelPhone: "Phone Number",
        btnCancel: "Cancel",
        btnRegister: "Register",
        btnFirstOrder: "First Time", btnRepeatOrder: "Order",
        btnSubmitFirst: "Get Guide", btnSubmitRepeat: "Order",
                noticeBody:`- For your first order, please make sure to register via the "First Time" button.<br>- Click a product photo to see its description.<br>- Fillets are also available to order — please try a variety of fish.`
    }
};

// 3. HELPERS
function esc(str) { return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function getProductName(p) { return currentLang === 'jp' ? (p.name_jp || p.name_en || '') : (p.name_en || p.name_jp || ''); }
function getProductComment(p) { return currentLang === 'jp' ? (p.comment_jp || p.comment_en || '') : (p.comment_en || p.comment_jp || ''); }
function getVariantName(v) { return currentLang === 'jp' ? (v.variant_name_jp || v.variant_name_en || '') : (v.variant_name_en || v.variant_name_jp || ''); }
function getCategoryValue(p) { return (p.category_id || p.category || '').trim(); }
function toNumber(v, f = 0) { const n = Number(v); return Number.isFinite(n) ? n : f; }
function getCalcClass(p) { return (p.variants || []).some(v => String(v.price_unit).toLowerCase() === 'kg') ? 'weight' : 'qty'; }
function getCalcLabel(p) { return getCalcClass(p) === 'weight' ? UI_TEXT[currentLang].weightCalc : UI_TEXT[currentLang].qtyCalc; }

// 4. CORE FUNCTIONS
async function fetchProducts() {
    try {
        const res = await fetch(GAS_URL);
        const data = await res.json();
        catalogUpdateDate = data.updateDate || '';
        if (data.updateDate && document.getElementById('update-date')) {
            document.getElementById('update-date').textContent = 'UPDATE: ' + data.updateDate;
        }
        const raw = Array.isArray(data.products) ? data.products : [];
        allProducts = raw.map(p => {
            const vs = Array.isArray(p.variants) ? p.variants : [];
            const sortedVs = vs.sort((a, b) => toNumber(a.sort_order, 9999) - toNumber(b.sort_order, 9999));
            return { ...p, variants: sortedVs };
        }).filter(p => (p.name_jp || p.name_en || '').trim() !== '')
          .sort((a, b) => toNumber(a.sort_order, 9999) - toNumber(b.sort_order, 9999));
        applyFilters();
    } catch (e) {
        const pc = document.getElementById('product-container');
        if (pc) pc.innerHTML = `<p>⚠️ Load Failed: ${esc(e.message)}</p>`;
    }
}

function filterCategory(cat, btn) {
    currentCategory = cat;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    applyFilters();
}

function applyFilters() {
    const search = (document.getElementById('search-input')?.value || '').toLowerCase().trim();
    const filtered = allProducts.filter(p => {
        const totalStock = (p.variants || []).reduce((sum, v) => {
            const val = Number(v.stock);
            return sum + (isNaN(val) ? 0 : val);
        }, 0);

        const countryVal = String(p.country || '').trim().toUpperCase();

        let matchesCat = false;
        if (currentCategory === 'OUT_OF_STOCK') {
            matchesCat = (totalStock <= 0);
        } else if (currentCategory === 'COUNTRY_KH') {
            matchesCat = (countryVal === 'CAMBODIA' && totalStock > 0);
        } else if (currentCategory === 'COUNTRY_JP') {
            matchesCat = (countryVal === 'JAPAN' && totalStock > 0);
        } else {
            // 鮮魚一匹（FRESH-WHOLE）はフィレ系カテゴリへ統合表示（2026-08-05）。データ側のカテゴリ値は変更しない
            const catMatch = (currentCategory === 'ALL' || getCategoryValue(p) === currentCategory ||
                (currentCategory === 'FRESH-FILLET/DR/SD' && getCategoryValue(p) === 'FRESH-WHOLE'));
            matchesCat = catMatch && (totalStock > 0);
        }
        const matchesSearch = !search || 
            getProductName(p).toLowerCase().includes(search) || 
            getProductComment(p).toLowerCase().includes(search);
        return matchesCat && matchesSearch;
    });
    lastFiltered = filtered; // Excelダウンロード「表示中」が参照する
    displayProducts(filtered);
}

// 5. DISPLAY & RENDER
function displayProducts(products) {
    const pc = document.getElementById('product-container');
    const rs = document.getElementById('recommend-section');
    const rc = document.getElementById('recommend-container');
    if (!pc) return;

    const recs = products.filter(p => toNumber(p.recommend_today, 0) === 1);
    const norms = products.filter(p => toNumber(p.recommend_today, 0) !== 1);

    if (rc) rc.innerHTML = recs.map(buildCard).join('');
    if (rs) recs.length > 0 ? rs.classList.remove('hidden') : rs.classList.add('hidden');
    
    pc.innerHTML = norms.length === 0 && recs.length === 0 
        ? `<p style="text-align:center;padding:30px;">${UI_TEXT[currentLang].noProducts}</p>` 
        : norms.map(buildCard).join('');
}

function buildCard(p) {
    const t = UI_TEXT[currentLang];
    const pid = esc(p.product_id);
    const name = esc(getProductName(p));

    let originHTML = '';
    const countryVal = String(p.country || '').trim().toUpperCase(); 
    if (countryVal === 'CAMBODIA') {
        originHTML = `<div class="origin-tag"><span class="origin-text">${t.origin_kh}</span><img src="images/kh-flag.png" class="country-flag" alt="KH"></div>`;
    } else if (countryVal === 'JAPAN') {
        originHTML = `<div class="origin-tag"><span class="origin-text">${t.origin_jp}</span><img src="images/jp-flag.png" class="country-flag" alt="JP"></div>`;
    }
    
    const vsHTML = (p.variants || [])
        .filter(v => {
            const stockNum = toNumber(v.stock, 0);
            return currentCategory === 'OUT_OF_STOCK' ? stockNum <= 0 : stockNum > 0;
        })
        .map(v => {
            const vid = esc(v.variant_id);
            const qty = cart[vid]?.qty || 0;
            const stockNum = toNumber(v.stock, 0);
            const isOut = stockNum <= 0;
            const atMax = qty + 1 > stockNum; // 次の＋でストック超過なら無効化（端数在庫でもガード判定と一致・2026-08-05）
            // 表記: 「名称：$価格/kg|/pic」（区切りは：・単位はバリアントのprice_unit基準で kg→/kg・それ以外→/pic）
            const unitSuffix = String(v.price_unit).toLowerCase() === 'kg' ? '/kg' : '/pic';
            const sep = currentLang === 'jp' ? '：' : ': ';
            return `
                <div class="variant-row">
                    <button class="variant-select-btn" onclick="selectVariantImage('${pid}', '${esc(v.image_variant)}', '${esc(p.image_main)}', this)">
                        ${esc(getVariantName(v))}${sep}$${toNumber(v.price_usd).toFixed(2)}${unitSuffix}
                    </button>
                    <div class="variant-qty-wrap">
                        <button class="qty-btn" onclick="changeCartQty('${vid}', -1)">−</button>
                        <span class="variant-qty">${qty}</span>
                        <button class="qty-btn" onclick="changeCartQty('${vid}', 1)" ${(isOut || atMax) ? 'disabled' : ''}>＋</button>
                        ${stockNum > 0 ? `<span class="variant-stock">${t.stockLeft}${stockNum}</span>` : ''}
                    </div>
                </div>`;
        }).join('');

    return `
    <div class="card" data-category="${esc(getCategoryValue(p))}">
        <div class="img-wrapper">
            ${p.image_main ? `<img id="product-image-${pid}" src="${esc(p.image_main)}" alt="${name}" onclick="openModal(this.src, '${pid}')">` : `<div class="img-placeholder">🐟</div>`}
        </div>
        <div class="info">
            <div class="product-title-row">
                <h3>[${esc(p.code || '---')}] ${name}</h3>
                ${originHTML}
            </div>
            <div class="size-calc-row">
                <p class="size-detail">${esc(p.size || '')}</p>
                <span class="calc-mini ${getCalcClass(p)}">${getCalcLabel(p)}</span>
            </div>
            <div class="variant-list">${vsHTML}</div>
        </div>
    </div>`;
}

// 6. CART LOGIC
function getVariantStock(vid) {
    for (const p of allProducts) {
        const v = (p.variants || []).find(x => x.variant_id === vid);
        if (v) return toNumber(v.stock, 0);
    }
    return Infinity; // 商品リストに見つからない場合は従来挙動（ガードなし）
}

function changeCartQty(vid, delta) {
    let targetVariant = null, targetProduct = null;
    for (const p of allProducts) {
        const v = p.variants.find(v => v.variant_id === vid);
        if (v) { targetVariant = v; targetProduct = p; break; }
    }
    if (!targetVariant) return;
    // ストック数以上には増やせない（商品カード・カート画面共通のガード・2026-08-05）
    if (delta > 0 && (cart[vid]?.qty || 0) + delta > toNumber(targetVariant.stock, 0)) return;
    if (!cart[vid]) {
        if (delta <= 0) return;
        // コード基準（2026-08-01 光信さん裁定・2026-08-10 凍結解除）：variant_id の V_右側＝魚ポチ/FISHCODEと
        // 同粒度のバリアントコード（例 V_BC210LL → BC210LL）を最優先。無い/形式外は variant_code → 商品コードへ
        // フォールバック（従来挙動）。形式検証：GAS側パーサが確実に抽出できる英数字3文字以上のみ採用
        // （V_P_BC825 等の不正形式は従来どおり商品コードで発行＝IN行落ち退行の防止・レビュー5巡目）
        const vRaw = (typeof vid === 'string' && vid.indexOf('V_') === 0) ? vid.slice(2) : '';
        const vCodeFromId = /^[A-Z0-9]{3,}$/.test(vRaw) ? vRaw : '';
        cart[vid] = { variant_id: vid, qty: 0, price_usd: toNumber(targetVariant.price_usd), product_name_jp: targetProduct.name_jp, product_name_en: targetProduct.name_en, variant_name_jp: targetVariant.variant_name_jp || "", variant_name_en: targetVariant.variant_name_en || "", code: vCodeFromId || targetVariant.variant_code || targetProduct.code };
    }
    cart[vid].qty += delta;
    if (cart[vid].qty <= 0) delete cart[vid];
    applyFilters(); 
    renderCart();
}

function renderCart() {
    const t = UI_TEXT[currentLang];
    const items = Object.values(cart);
    const panel = document.getElementById('cart-panel');
    if (!panel) return;
    const currentNotes = document.getElementById('cart-notes')?.value || "";
    const cartTitle = currentLang === 'jp' ? "ご注文内容" : "Your Order";
    const notesTitle = currentLang === 'jp' ? "メモ" : "Notes";

    let listContent = items.length === 0 ? `<p style="text-align:center; padding:30px; color:#999; margin:0;">${t.emptyCart}</p>` : items.map(item => `
        <div class="cart-item" style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid #eee;">
            <div style="flex:1; text-align:left;">
                 <strong style="font-size:0.9rem; display:block;">[${esc(item.code || '---')}] ${esc(currentLang === 'jp' ? item.product_name_jp : item.product_name_en)}</strong>
                 <span style="font-size:0.85rem; color:#555; display:block;">${esc(currentLang === 'jp' ? item.variant_name_jp : item.variant_name_en)}</span>
                 <span style="font-size:0.85rem; color:#666;"> × ${item.qty}</span>
            </div>
            <div style="display:flex; gap:5px;">
                <button class="qty-btn" onclick="changeCartQty('${item.variant_id}', -1)">−</button>
                <button class="qty-btn" onclick="changeCartQty('${item.variant_id}', 1)" ${item.qty + 1 > getVariantStock(item.variant_id) ? 'disabled' : ''}>＋</button>
            </div>
        </div>`).join('');

    panel.innerHTML = `
        <div style="background:#333; color:#fff; padding:12px 15px; display:flex; justify-content:space-between; align-items:center;">
            <h2 style="margin:0; font-size:1rem; color:#fff;">🛒 ${cartTitle}</h2>
            <button onclick="closeCartPanel()" style="color:#fff; border:none; background:none; font-size:1.5rem; cursor:pointer; line-height:1;">×</button>
        </div>
        <div style="flex:1; overflow-y:auto; padding:15px; display:flex; flex-direction:column;">
            ${listContent}
            <div style="margin-top:auto; padding-top:15px; text-align:left;">
                <label style="display:block; font-weight:bold; margin-bottom:5px; font-size:0.85rem;">${notesTitle}</label>
                <textarea id="cart-notes" style="width:100%; height:60px; border:1px solid #ccc; border-radius:4px; padding:5px; box-sizing:border-box;">${esc(currentNotes)}</textarea>
            </div>
        </div>
        <div style="padding:15px; background:#f9f9f9; border-top:1px solid #ddd;">
            <div style="display:flex; gap:8px;">
                <button onclick="submitFirstOrder()" style="flex:1; padding:12px 5px; font-size:0.75rem; font-weight:bold; border-radius:6px; background:#666; color:#fff; border:none;">${currentLang === 'jp' ? '初めての方' : 'First Time'}</button>
                <button onclick="showOrderCheckModal()" style="flex:1; padding:12px 5px; font-size:0.75rem; font-weight:bold; border-radius:6px; background:#333; color:#fff; border:none;">${currentLang === 'jp' ? 'ご注文' : 'Order'}</button>
                <button onclick="clearCart()" style="padding:12px 10px; font-size:0.75rem; border-radius:6px; background:#eee; border:none;">${currentLang === 'jp' ? 'クリア' : 'Clear'}</button>
            </div>
        </div>`;
    const badge = document.getElementById('cart-count-badge');
    if (badge) badge.textContent = items.reduce((s, i) => s + i.qty, 0);
}

function clearCart() { cart = {}; currentClientOrderId = ''; applyFilters(); renderCart(); closeCartPanel(); }

function setLang(lang) {
    currentLang = lang;
    const t = UI_TEXT[lang];
    document.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('active', b.id === 'lang-' + lang));
    const mapping = { 'cat-all': t.cat_all, 'cat-kh': t.cat_kh, 'cat-jp': t.cat_jp,'cat-frozen': t.cat_frozen, 'cat-fillet': t.cat_fillet, 'cat-oil': t.cat_oil, 'cat-kitchen': t.cat_kitchen, 'cat-vege': t.cat_vege, 'cat-waiting': t.cat_waiting, 'inquiry-text': t.inquiry, 'search-input': t.searchPlaceholder, 'notice-summary-text': t.noticeTitle, 'notice-body-content': t.noticeBody, 'recommend-title': t.recommendTitle, 'export-current-btn': t.exportCurrent, 'export-all-btn': t.exportAll };
    for (let id in mapping) {
        const el = document.getElementById(id);
        if (el) {
            if (id === 'notice-body-content') el.innerHTML = mapping[id];
            else if (el.tagName === 'INPUT') el.placeholder = mapping[id];
            else el.textContent = mapping[id];
        }
    }
    applyFilters(); renderCart();
}

// 7. UI CONTROL
function toggleCartPanel() { document.getElementById('cart-panel')?.classList.toggle('show'); }
function closeCartPanel() { document.getElementById('cart-panel')?.classList.remove('show'); }
// 写真ポップアップ。pid があれば商品説明（comment_jp/en・表示中の言語）を写真の下に表示（2026-08-01）
function openModal(src, pid) {
    const m = document.getElementById('image-modal'), i = document.getElementById('modal-img');
    if (!m || !i) return;
    i.src = src;
    const cap = document.getElementById('modal-caption');
    if (cap) {
        const p = pid ? allProducts.find(x => String(x.product_id) === String(pid)) : null;
        const text = p ? getProductComment(p) : '';
        cap.textContent = text;
        cap.style.display = text ? '' : 'none'; // 説明なしの商品は従来どおり写真のみ
    }
    m.style.display = 'flex';
}
function closeModal() { document.getElementById('image-modal').style.display = 'none'; }
function selectVariantImage(pid, vImg, fImg, btn) {
    const img = document.getElementById(`product-image-${pid}`);
    if (img) img.src = vImg && vImg.trim() !== '' ? vImg : fImg;
    if (btn) { btn.closest('.variant-list').querySelectorAll('.variant-select-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
}

// 8. ORDER LOGIC
function submitFirstOrder() {
    const t = UI_TEXT[currentLang];
    document.getElementById('modal-title').textContent = t.modalTitle;
    document.getElementById('label-shop').textContent = t.labelShop;
    document.getElementById('label-staff').textContent = t.labelStaff;
    document.getElementById('label-phone').textContent = t.labelPhone;
    document.getElementById('btn-cancel').textContent = t.btnCancel;
    document.getElementById('btn-submit').textContent = t.btnRegister;
    setRegStatus('', '#666'); // 前回の成否メッセージを消してから開く
    document.getElementById('first-time-modal').style.display = 'flex';
}
function closeFirstTimeModal() { document.getElementById('first-time-modal').style.display = 'none'; }

// 登録モーダルのインライン状態行（#reg-status-msg）を色付きで更新（H-5・デザイン§4-3）
function setRegStatus(msg, color) {
    const el = document.getElementById('reg-status-msg');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = color || '#666';
}

async function processFirstTimeRegistration() {
    const s = document.getElementById('reg-shop-name')?.value.trim(), n = document.getElementById('reg-staff-name')?.value.trim(), p = document.getElementById('reg-phone')?.value.trim();
    const submitBtn = document.getElementById('btn-submit');
    // 入力不足：状態行に案内してモーダル保持（デザイン§3-4）
    if (!p || !s || !n) {
        setRegStatus(currentLang === 'jp'
            ? '⚠️ 店名・担当者名・電話番号をすべてご入力ください。'
            : '⚠️ Please fill in shop name, contact person, and phone number.', '#c62828');
        return;
    }
    // 送信中表示＋二重送信防止
    setRegStatus(currentLang === 'jp' ? '送信中です…📡' : 'Sending… 📡', '#666');
    if (submitBtn) submitBtn.disabled = true;
    try {
        // H-5: no-cors廃止→通常fetchで応答検証。Content-Type は付けない（preflight回避・設計§3-2）
        const res = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'register_user', phone: p, username: s, firstName: n })});
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const result = await res.json();
        if (!result || result.status !== 'ok') throw new Error((result && result.message) || 'register failed');
        // 成功：Telegramへは飛ばさず、選んだカートへ戻って注文を続けてもらう（導線A・2026-07-08）。
        // Telegram連携は注文完了モーダルのボタンから（アプリ内ブラウザでカートが空に見える問題の解消）。
        setRegStatus(currentLang === 'jp'
            ? '✅ ご登録を受け付けました！\nこのままご注文いただけます🛒（Telegram通知はご注文後にご案内します）'
            : '✅ Registration received!\nYou can order right away 🛒 (We\'ll set up Telegram notifications after your order)', '#2e7d32');
        localStorage.setItem('user_phone', p); // 注文確認と注文後のTelegram連携ボタンで再利用
        setTimeout(() => {
            closeFirstTimeModal();
            document.getElementById('cart-panel')?.classList.add('show'); // 選んだカートに戻す
        }, 1500);
    } catch (e) {
        // 失敗：入力値を保持し再試行可能に（カートも保持）
        setRegStatus(currentLang === 'jp'
            ? '⚠️ ご登録に失敗しました。通信環境をご確認のうえ、もう一度お試しください。'
            : '⚠️ Registration failed. Please check your connection and try again.', '#c62828');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

// send_order の冪等キー生成（UUID優先・非対応環境は nonce にフォールバック・設計§5-1）
function genClientOrderId() {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'w-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function showOrderCheckModal() {
    const items = Object.values(cart);
    if (items.length === 0) { alert(currentLang === 'jp' ? "カートが空です" : "Cart is empty"); return; }
    const jp = currentLang === 'jp';
    // 確認セッションの冪等キーを採番（未採番時のみ＝再試行では同一キーを維持し二重起票を防ぐ）
    if (!currentClientOrderId) currentClientOrderId = genClientOrderId();
    // 見出し・リード文・ラベル・補助文・ボタン（デザイン§3-1）
    document.getElementById('check-title').textContent = jp ? 'ご注文内容の確認' : 'Confirm Your Order';
    document.getElementById('check-lead').textContent = jp
        ? '以下の内容で承ります。よろしければ「確定する」を押してください🐟'
        : 'Please review your order below, then tap "Confirm" 🐟';
    document.getElementById('check-items-label').textContent = jp ? '🛒 ご注文品' : '🛒 Your Items';
    document.getElementById('check-phone-label').textContent = jp ? '📱 ご連絡先（電話番号）' : '📱 Phone Number';
    document.getElementById('check-phone-note').textContent = jp
        ? '未登録でもご注文いただけます。ご登録済みの方は同じ番号をご入力ください。'
        : "Orders are accepted even if you're not registered yet. If registered, use the same number.";
    document.getElementById('check-btn-back').textContent = jp ? '戻る' : 'Back';
    document.getElementById('check-btn-confirm').textContent = jp ? '確定する' : 'Confirm';
    // ご注文品の明細（カート各品を反復・明細表記はデザイン§3-1）
    document.getElementById('check-order-summary').innerHTML = items.map(item => {
        const nm = esc(jp ? item.product_name_jp : item.product_name_en);
        const vn = esc(jp ? item.variant_name_jp : item.variant_name_en);
        const qtyText = jp ? `× ${item.qty}点` : `× ${item.qty}`;
        return `<div style="padding:4px 0; border-bottom:1px solid #eee;">[${esc(item.code || '---')}] ${nm} ${vn} ${qtyText}</div>`;
    }).join('');
    document.getElementById('order-check-modal').style.display = 'flex';
    const saved = localStorage.getItem('user_phone');
    if (saved) document.getElementById('check-phone').value = saved;
}

// 注文結果モーダルを構成（成功=登録済み/未登録・失敗を1枚で切替・デザイン§3-2/§3-3）
function showOrderResult(kind, orderNo) {
    const jp = currentLang === 'jp';
    const icon = document.getElementById('result-icon');
    const title = document.getElementById('result-title');
    const noEl = document.getElementById('result-orderno');
    const body = document.getElementById('result-body');
    const primary = document.getElementById('result-btn-primary');
    const secondary = document.getElementById('result-btn-secondary');
    const hasNo = !!(orderNo && String(orderNo).trim());

    // 送信失敗（⚠️は本物の失敗のみ・番号非表示・カート保持）
    if (kind === 'failed') {
        icon.textContent = '⚠️';
        title.textContent = jp ? '送信できませんでした' : "Couldn't Send";
        noEl.textContent = ''; noEl.style.display = 'none';
        body.textContent = jp
            ? '通信環境をご確認のうえ、もう一度お試しください。\nご注文内容（カート）はそのまま残っています🛒'
            : 'Please check your connection and try again.\nYour cart has been kept 🛒';
        secondary.style.display = '';
        secondary.textContent = jp ? '閉じる' : 'Close';
        secondary.onclick = closeOrderResult; // 閉じるのみ（カート保持）
        primary.textContent = jp ? 'もう一度試す' : 'Retry';
        primary.onclick = () => { closeOrderResult(); document.getElementById('order-check-modal').style.display = 'flex'; };
        document.getElementById('order-result-modal').style.display = 'flex';
        return;
    }

    // 受付完了（登録済み/未登録とも ✅・拒否面にしない・デザイン§3-2）
    icon.textContent = '✅';
    title.textContent = jp ? 'ご注文を承りました' : 'Order Received';
    noEl.textContent = hasNo ? (jp ? `ご注文番号：${orderNo}` : `Order No.: ${orderNo}`) : '';
    noEl.style.display = hasNo ? '' : 'none';

    if (!hasNo) {
        // orderNo 欠落（万一 GAS 旧版）：W番号なしの汎用成功にフォールバック（設計§3-1）
        body.textContent = jp ? 'ご注文を承りました。' : 'Your order has been received.';
        secondary.style.display = 'none';
        primary.textContent = jp ? '閉じる' : 'Close';
        primary.onclick = closeOrderResult; // カートは受付完了時に破棄済み（M-3）
    } else if (kind === 'registered') {
        body.textContent = jp
            ? 'Telegramに確認メッセージをお送りしました📩\n担当者が内容を確認し、追ってご連絡いたします🐟'
            : "We've sent a confirmation to your Telegram 📩\nOur staff will review it and get back to you 🐟";
        secondary.style.display = 'none';
        primary.textContent = jp ? '閉じる' : 'Close';
        primary.onclick = closeOrderResult; // カートは受付完了時に破棄済み（M-3）
    } else { // unregistered（拒否しない：受付完了＋Telegram連携はここから・導線A 2026-07-08）
        body.textContent = jp
            ? 'ご注文はしっかりお受けしました✅\n\n📱 下のボタンからTelegramを開くと、ご注文の確認メッセージをTelegramで受け取れるようになります（今回のご注文はこのまま進みます）。'
            : 'Your order has been received ✅\n\n📱 Tap below to open Telegram and get your order confirmations there (this order is already being processed).';
        secondary.style.display = '';
        secondary.textContent = jp ? '閉じる' : 'Close';
        secondary.onclick = closeOrderResult; // カートは受付完了時に破棄済み（M-3）
        primary.textContent = jp ? '📱 Telegramで確認を受け取る' : '📱 Get updates on Telegram';
        primary.onclick = () => { // 注文受付済み＝カート破棄済みなのでページを離れても安全（M-3）
            const ph = (localStorage.getItem('user_phone') || '').replace(/\D/g, '');
            closeOrderResult();
            window.open(ph ? `https://t.me/sakanaya_bot?start=${ph}` : 'https://t.me/sakanaya_bot', '_blank');
        };
    }
    document.getElementById('order-result-modal').style.display = 'flex';
}
function closeOrderResult() { document.getElementById('order-result-modal').style.display = 'none'; }

async function finalizeOrderProcess() {
    const p = document.getElementById('check-phone')?.value.trim(), n = document.getElementById('cart-notes')?.value.trim(), items = Object.values(cart);
    if (!p) { alert(currentLang === 'jp' ? "電話番号を入力してください。" : "Please enter your phone number."); return; }
    document.getElementById('order-check-modal').style.display = 'none';
    localStorage.setItem('user_phone', p);
    // 冪等キー：確認モーダルで採番済みを使う（未採番なら生成）＝再送の二重起票防止（設計§5-1）
    if (!currentClientOrderId) currentClientOrderId = genClientOrderId();
    let orderData = '【New Order】\n';
    items.forEach(i => { orderData += `${i.code || '---'} ${currentLang === 'jp' ? i.product_name_jp : i.product_name_en} ${currentLang === 'jp' ? i.variant_name_jp : i.variant_name_en} x ${i.qty}点\n`; });
    try {
        // spreadsheetId/targetGroupId は送らない（0-5/0-6クローズ）。Content-Type 未指定で preflight 回避（設計§3-2）
        const res = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'send_order', phone: p, orderData: orderData, notes: n, clientOrderId: currentClientOrderId })});
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const result = await res.json();
        // status==="error" のみ失敗扱い。旧応答 status==="unregistered" は拒否せず受付完了へ倒す（拒否アラート廃止）
        if (result && result.status === 'error') throw new Error(result.message || 'server error');
        // 新応答 {status:"ok", orderNo, registered}。registered!==true は未登録として案内付き受付完了に
        const registered = !!(result && result.registered === true);
        showOrderResult(registered ? 'registered' : 'unregistered', result && result.orderNo);
        // 受付完了した時点でカート・冪等キーを破棄＝登録有無に関わらず別W行の二重注文を防ぐ（M-3・clearCart が currentClientOrderId も空に）
        clearCart();
    } catch (e) {
        // 通信失敗/サーバエラー：偽の成功を出さずカート保持で失敗モーダル（H-1・デザイン§3-3）
        showOrderResult('failed', '');
    }
}

// 9. CATALOG EXPORT（商品リストのExcel(CSV)ダウンロード・クライアント側のみ）
// CSVセル1つをExcel互換にエスケープ（カンマ・改行・"を含む値は""で囲み、内部の"は重ねる）
function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Excel数式解釈ガード（テキスト列のみに適用・2026-08-01）
// 先頭が = + - @ TAB CR だとExcelが数式扱いし #NAME? 化け・数式実行の恐れ → ' を前置して文字列固定
function csvGuard(v) {
    const s = String(v == null ? '' : v);
    return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

// 商品配列 → CSVの行配列（見出し＋規格ごとに1行）。表示中の言語で出力
function buildCatalogRows(products, includeOutOfStock) {
    const jp = currentLang === 'jp';
    const header = jp
        ? ['コード', '商品名', '原産国', 'サイズ', '規格', '価格(USD)', '単位', '在庫']
        : ['Code', 'Product Name', 'Origin', 'Size', 'Variant', 'Price(USD)', 'Unit', 'Stock'];
    const rows = [header];
    products.forEach(p => {
        const name = getProductName(p);
        const cc = String(p.country || '').trim().toUpperCase();
        const origin = cc === 'CAMBODIA' ? (jp ? 'カンボジア産' : 'CAMBODIA')
                     : cc === 'JAPAN' ? (jp ? '日本産' : 'JAPAN') : '';
        (p.variants || [])
            .filter(v => includeOutOfStock ? toNumber(v.stock, 0) <= 0 : toNumber(v.stock, 0) > 0)
            .forEach(v => {
                // テキスト6列はcsvGuardで数式解釈を防止。価格・在庫は数値生成のため対象外（数値性を保つ）
                rows.push([
                    csvGuard(p.code || ''),
                    csvGuard(name),
                    csvGuard(origin),
                    csvGuard(p.size || ''),
                    csvGuard(getVariantName(v)),
                    toNumber(v.price_usd).toFixed(2),
                    csvGuard(v.price_unit || ''),
                    toNumber(v.stock, 0)
                ]);
            });
    });
    return rows;
}

// scope: 'current'=表示中の絞り込み結果 / 'all'=在庫のある全商品。BOM付きCSVをダウンロード（Excelで直接開ける）
function exportCatalog(scope) {
    const outOfStockView = (scope === 'current' && currentCategory === 'OUT_OF_STOCK');
    const products = (scope === 'all')
        ? allProducts.filter(p => (p.variants || []).reduce((s, v) => s + toNumber(v.stock, 0), 0) > 0)
        : lastFiltered;
    const rows = buildCatalogRows(products, outOfStockView);
    if (rows.length <= 1) {
        alert(currentLang === 'jp' ? '出力できる商品がありません。' : 'No products to export.');
        return;
    }
    const csv = rows.map(r => r.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const datePart = (catalogUpdateDate || '').replace(/[^0-9A-Za-z]/g, '') || 'latest';
    const fname = `SAKANAYA_PRODUCTLIST_${datePart}.csv`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 10. INITIALIZE
document.addEventListener('DOMContentLoaded', async () => {
    await fetchProducts();
    setLang(currentLang);
    const saved = localStorage.getItem('temp_cart');
    if (saved) { try { Object.assign(cart, JSON.parse(saved)); renderCart(); localStorage.removeItem('temp_cart'); } catch (e) {} }
});
