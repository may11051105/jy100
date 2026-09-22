// 全域宣告
let selectedItems = {};
let productDB = {};
let priceLookup = {};
let globalOrderText = "";
let currentTabId = "p1";
let toastTimer = null; 
let secretPassword = "";
let isStoreClosed = false;
// ==============================================
// 載入商品資料並建立快取
// ==============================================
async function loadProducts() {
  const cacheKey = CONFIG.cacheKey || "jin_mall_products";
  const cache = localStorage.getItem(cacheKey);
  if (cache) {console.log("⚡ 優先載入 LocalStorage 快取資料");
    try {
      processData(JSON.parse(cache));
      render();
    } catch (e) {console.warn("快取解析失敗，準備向 Firebase 重新抓取");}
  }
  
  recordDailyVisitor(); //👤記錄訪客
  await fetchLatestData();
}

async function fetchLatestData() {
  const toast = document.getElementById("loading-toast");
  if (toast) toast.style.display = "block";

  const cacheKey = CONFIG.cacheKey || "jin_mall_products";
  const cacheTimeKey = cacheKey + "_time";

  try {
    console.log(`🌐 正在從 Firebase 讀取 [${CONFIG.firebaseNode}] 最新資料...`);

    const snapshot = await dbFirebase.ref(CONFIG.firebaseNode).once("value");
    const data = snapshot.val();

    if (!data || (Array.isArray(data) && data.length === 0)) {
      throw new Error("⚠️ Firebase 回傳空資料");}

    const dataArray = Array.isArray(data) ? data : Object.values(data);

    setSafeCache(cacheKey, JSON.stringify(dataArray));
    setSafeCache(cacheTimeKey, Date.now().toString());

    processData(dataArray);
    render();
    console.log("✅ Firebase 最新資料讀取並渲染完成！");
  } catch (error) {console.error("❌ 讀取 Firebase 失敗：", error);

    const cache = localStorage.getItem(cacheKey);
    if (cache) {console.warn("使用舊快取資料顯示");
      processData(JSON.parse(cache));
      render();
      if (typeof showRefreshToast === "function") {
        showRefreshToast("⚠️ 無法取得最新資料，目前顯示為舊內容");}
    } else {alert("⚠️ 無法載入商品資料，請檢查網路連線或規則設定。");}
  } finally {
    if (toast) toast.style.display = "none";}
}

function setSafeCache(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {console.warn("⚠️ 瀏覽器阻擋 LocalStorage 寫入");}
}

function getSafeCache(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {console.warn("⚠️ 瀏覽器阻擋 LocalStorage 讀取");
    return null;
  }
}

// ==============================================
// 處理商品資料
// ==============================================
function processData(data) {
  productDB = {};
  priceLookup = {};

  data.forEach((item) => {
    const key = String(item.key).toLowerCase();
    if (!productDB[key]) {
      productDB[key] = [];
    }

    const rawPrice = String(item.price).trim();
    const productInfo = {
      key: key,
      g: item.group || "",
      n: item.name,
      p: Number(item.price),
      rawPrice: rawPrice,
      f: item.desc || "",
      l: item.limit || "",
      stock: normalizeStock(item.stock),
      enabled: item.enabled || "Y",
    };
    productDB[key].push(productInfo);
    priceLookup[item.name] = productInfo.p;
  });
}

// ==============================================
//-- 讀取:密碼驗證p99.休站Closed
// ==============================================
async function loadSettings() {
  try {
    const res = await fetch(
      "https://jzmenu-a79cd-default-rtdb.asia-southeast1.firebasedatabase.app/settings.json",
    );

    const data = await res.json();
    // 讀取p99專區密碼
    if (data && data.secretPassword !== undefined) {
      secretPassword = String(data.secretPassword); }
    // 只有 Closed「數字 0」才進入休站模式
    isStoreClosed = data && data.Closed === 0;
    // 如果已經進入休站，鎖定商品上的輸入框
    if (isStoreClosed) {
      document.querySelectorAll(".qty").forEach((input) => {
        input.disabled = true; });
      showMaintenance(); }
  } catch (e) {console.warn("⚠️ 無法取得設定檔:", e); }
}

// ==============================================
//-- 分頁標籤
// ==============================================
//-- 分頁切換
function openTab(evt, tabId) {
  currentTabId = tabId;
  document.querySelectorAll(".tab-content")
    .forEach((c) => c.classList.remove("active"));
  document.querySelectorAll(".tab-btn")
    .forEach((b) => b.classList.remove("active"));
  document.getElementById(tabId).classList.add("active");
  evt.currentTarget.classList.add("active");
  // 選中的分頁自動滑到中間
  evt.currentTarget.scrollIntoView({
    behavior: "smooth",
    inline: "center",
    block: "nearest"
  });
}
//-- 分頁左右箭頭滑動
function scrollTabs(direction) {
  const tabs = document.querySelector(".tabs");

  tabs.scrollBy({
    left: direction * 200, //移動px
    behavior: "smooth",
  });
}

//--判斷庫存:
function normalizeStock(rawStock) {
  if (rawStock === "" || rawStock === null || rawStock === undefined)
    return null;
  const parsedStock = Number(rawStock);
  return Number.isFinite(parsedStock) ? parsedStock : null;
}

// ==============================================
// 渲染 HTML 元件:顯示商品、價格、數量輸入框
// ==============================================
function renderItem(item) {
  const savedQty = selectedItems[item.n] || "";
  const isOutOfStock = item.stock === 0;
  const hasLimit = Number.isFinite(item.stock) && item.stock > 0;
  const disabled = item.enabled === "N";
  //處理父商品
  const isGroup = item.p === -1 && item.key.split("-").length === 2;
  const rowClass = isGroup
    ? "item-row group-row"
    : disabled
      ? "item-row disabled-item"
      : isOutOfStock
        ? "item-row out-of-stock"
        : "item-row";

  const maxAttr = hasLimit ? `max="${item.stock}"` : "";
  const stockNotice = hasLimit
    ? `<span class="stock-tip">[剩${item.stock}]</span>`
    : "";
  const isTextPrice = Number.isNaN(item.p);
  
  //鎖定輸入框 (判斷時機)
 const inputAttr =
  isGroup || isTextPrice || isOutOfStock || disabled || isStoreClosed
    ? "disabled"
    : "";
  //特殊事件處理
  const isGift = item.p === 0;
  const priceDisplay = isGroup
    ? '<span style="font-size:13px; color:#777;">【規格】</span>'
    : disabled
      ? "X"
      : isOutOfStock
        ? "---"
        : isTextPrice
          ? item.rawPrice
          : isGift
            ? "🎁贈"
            : `$${item.p}`;

  const descWithStatus = disabled
    ? `${item.f}<span class="sold-out">【停】</span>`
    : isOutOfStock
      ? `${item.f}<span class="sold-out">【缺】</span>`
      : item.f;

  return `<div class="${rowClass}">
          <div class="item-info">
           ${isGroup ? '<span class="group-arrow">▶</span>' : '<span class="item-dot"></span>'}
            <span class="item-name">${item.n}</span>
             <span class="item-limit">${item.l}</span>
              <span class="item-desc">${descWithStatus}</span>
                ${!isOutOfStock && hasLimit ? stockNotice : ""}
                </div>
                <span class="item-price">${priceDisplay}</span>
                <input type="number" class="qty"
                       data-name="${item.n}"
                       value="${savedQty}"
                       min="0"
                       ${maxAttr} ${inputAttr}>
              </div>`;
}

// ==============================================
// -- 渲染商品:將renderItem()建立連結
// ==============================================
function render() {
  Object.keys(productDB).forEach((key) => {
    if (key.split("-").length !== 2) return;
    const container = document.getElementById(`list-${key}`);
    if (!container) return;

    let html = "";

    productDB[key].forEach((item) => {
      // 群組(price=-1)，尋找group子商品
      if (item.p === -1) {
        html += renderItem(item);
        const groupItems = productDB[key].filter(
          (child) => child.g === item.g && child !== item,
        );
        html += `<div class="group-content">`;
        groupItems.forEach((child) => {html += renderItem(child);});
        html += `</div>`;
      } else if (!item.g) {html += renderItem(item);}
    });

    html += `<div style="text-align:right; padding:5px 5px; border-top:1px dashed #eee;">
                <a href="#top-anchor">↑ 回到選單 ↑</a></div>`;
    container.innerHTML = html;
  });
}

//-- 群組折疊選單事件
document.addEventListener("click", function (e) {
  const row = e.target.closest(".group-row");
  if (!row) return;

  const group = row.nextElementSibling;
  if (!group || !group.classList.contains("group-content")) return;
  const arrow = row.querySelector(".group-arrow");

  if (group.classList.contains("open")) {
    group.classList.remove("open");
    arrow.textContent = "▶";
    return;
  }

  document.querySelectorAll(".group-content.open").forEach((openGroup) => {
    openGroup.classList.remove("open");
    const parentRow = openGroup.previousElementSibling;
    const parentArrow = parentRow?.querySelector(".group-arrow");
    if (parentArrow) parentArrow.textContent = "▶";
  });

  group.classList.add("open");
  arrow.textContent = "▼";
});

//-- 庫存事件驗證
function syncQty(name, value, inputEl = null) {
  let val = parseInt(value, 10);
  if (isNaN(val) || val < 0) val = 0;

  const input = inputEl || document.querySelector(`input[data-name="${name}"]`);
  if (input) {
    const maxAttr = input.getAttribute("max");
    const max =
      maxAttr !== null && maxAttr !== "" && !isNaN(Number(maxAttr))
        ? Number(maxAttr)
        : null;
    if (max !== null && val > max) {
      alert(`抱歉，該庫存僅剩 ${max} 件！`);
      val = max;
      input.value = max;
    }
  }
  selectedItems[name] = val;
  updateTotal(); // 金額中心
  updateCart();  // 購物車中心
}

// 輔助：selectedItems 記憶的數據同步畫面上的所有 input
function syncAllInputs() {
  document.querySelectorAll("input.qty").forEach((input) => {
    const name = input.dataset.name;
    if (name) {
      const qty = selectedItems[name];
      input.value = qty && qty > 0 ? qty : "";}
  });
}


// ==============================================
// 搜尋功能：輸入時自動切換、清空時無縫切回原本分頁
// ==============================================
let previousTabId = CONFIG.firebaseNode; // 紀錄搜尋前使用者原本處於的分頁
function handleSearch() {
  const searchInput = document.getElementById("searchInput");
  if (!searchInput) return;

  const keyword = searchInput.value.trim().toLowerCase();
  const searchContent = document.getElementById("search-content");
  const searchList = document.getElementById("list-search");
  const clearBtn = document.getElementById("search-clear-btn");

  if (clearBtn) {
    clearBtn.style.display = keyword.length > 0 ? "block" : "none"; }

  if (!keyword) {
    if (searchContent) searchContent.classList.remove("active");
    document.querySelectorAll(".tab-content")
      .forEach((tab) => tab.classList.remove("active"));
    document.querySelectorAll(".tab-btn")
      .forEach((b) => b.classList.remove("active"));
    if (typeof currentTabId !== "undefined" && currentTabId) {
      const activeTab = document.getElementById(currentTabId);
      if (activeTab) activeTab.classList.add("active");

      const activeBtn = document.querySelector(`.tab-btn[onclick*="${currentTabId}"]`,);
      if (activeBtn) activeBtn.classList.add("active");
    }

    // 切回原本 Tab 時，把最新的購物車數量同步回 DOM
    syncAllInputs();
    return;
  }

  document.querySelectorAll(".tab-content")
    .forEach((tab) => tab.classList.remove("active"));
  document.querySelectorAll(".tab-btn")
    .forEach((b) => b.classList.remove("active"));
  if (searchContent) searchContent.classList.add("active");

  let results = [];
  if (typeof productDB !== "undefined") {
    for (let key in productDB) {
      if (key === "p99-1") continue;
      if (Array.isArray(productDB[key])) {
        productDB[key].forEach((item) => {
          const nameMatch = item.n && item.n.toLowerCase().includes(keyword);
          const featureMatch = item.f && item.f.toLowerCase().includes(keyword);
          if (nameMatch || featureMatch) {results.push(item); }
        });
      }
    }
  }

  if (searchList) {
    if (results.length === 0) {searchList.innerHTML =
        "<div style='padding:20px; color:gray; text-align:center;'>找不到相關商品...</div>";
    } else {searchList.innerHTML = results.map(renderItem).join("");}
  }
}
//--搜尋✕按鈕時：清空搜尋欄並觸發還原
function clearSearch() {
  const searchInput = document.getElementById("searchInput");
  if (searchInput) searchInput.value = "";
  handleSearch();
}

// ==============================================
//-- 計算金額
// ==============================================
function updateTotal() {
  let total = 0;

  for (const name in selectedItems) {
    const qty = selectedItems[name];
    if (qty > 0) {
      const price = priceLookup[name];
      if (price !== undefined) {total += qty * price; }
    }
  }
  // 購物車金額
  const cartTotal = document.getElementById("cart-total");
  if (cartTotal) {cartTotal.innerText = total.toLocaleString();}
  // 商品金額
  const totalValEl = document.getElementById("total-val");
  if (totalValEl) {totalValEl.innerText = total.toLocaleString();}
}


//-- 監聽商品數量輸入
document.addEventListener("input", (e) => {
  if (e.target.classList.contains("qty")) {
    const input = e.target;
    syncQty(input.dataset.name, input.value, input); }
});

// ==============================================
// 購物車功能
// ==============================================
//-- 更新購物車：更新購物車裡的明細
function updateCart() {
  const cartContent = document.getElementById("cart-content");
  if (!cartContent) return;

  let cartHTML = "";
  let itemCount = 0;

  for (const name in selectedItems) {
    const qty = selectedItems[name];

    if (qty > 0) {
      const price = priceLookup[name];

      if (price !== undefined) {
        const sub = qty * price;
        itemCount++;
        cartHTML += `<li>
          <span>${itemCount}●${name} ${qty} x${price}</span>
          <span class="item-price">$${sub} <button onclick="removeItem('${name}')">❌</button></span>
        </li>`; }
    }
  }

  if (itemCount === 0) {
    // 沒商品
    cartContent.classList.add("empty-cart");
    cartContent.innerHTML = `
      <div>
        <div>⚠️ 購物車是空的~</div>
        <button class="btn" onclick="toggleCart()" style="background:var(--bg1); margin-top:20px;">
          返回商品區</button>
      </div>`;
  } else {
    // 有商品：建立購物車明細
    cartContent.classList.remove("empty-cart");
    cartContent.innerHTML = `<ul id="cart-list">${cartHTML}</ul>`; }

  const cartCount = document.getElementById("cart-count");
  if (cartCount) {cartCount.innerText = itemCount; }
}


//-- 購物車. 展開／收合
function toggleCart() {
  if (window.event) window.event.stopPropagation();
  const wrapper = document.getElementById("cart-wrapper");
  if (!wrapper) return;
  wrapper.style.display = ""; 
  wrapper.classList.toggle("expanded");
}

//-- 購物車. 清空
function clearCart() {
  if (confirm("確定要清空購物車嗎？")) {
    selectedItems = {};
    document.querySelectorAll(".qty").forEach((input) => (input.value = ""));
    updateTotal();
updateCart();
    const wrapper = document.getElementById("cart-wrapper");
    wrapper.classList.remove("expanded"); }
}
//-- 購物車. 刪除單項商品
function removeItem(name) {
  selectedItems[name] = 0;
  // 清空所有選單與搜尋結果中該商品的 input 
  document.querySelectorAll(
      `input[data-name="${CSS.escape ? CSS.escape(name) : name}"]`,)
    .forEach((el) => (el.value = ""));
  updateTotal(); // 金額中心
updateCart();  // 購物車中心
}


// ==============================================
//共用-- 處理按鈕行為: 複製、LINE、寄信選項
// ==============================================
async function handleAction(type) {
  const orderText = buildOrderText();
  //if (!orderText) return showLiveToast("⚠️ 未選商品！無法處理！");
  if (!orderText) return alert("⚠️ 未選商品！無法處理！");

  // 組合最終發送與複製的完整文字
  const text = `${orderText}\n\n👉 ${window.location.href}`;
  // 先複製到剪貼簿（解決 Yahoo 等 App 亂碼時的備用方案）
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {console.warn("剪貼簿複製失敗：", err);}

  // 根據按鈕類型執行動作
  if (type === 1)     // 1.僅複製
  {showLiveToast("✅ 已複製清單");} 
  
  else if (type === 2) // 2.複製+開啟LINE
  {showLiveToast("✅ 已複製清單，準備開啟 LINE"); 
    window.open("https://line.me/ti/p/7KQQFWwtR5", "_blank");} 
    
  else if (type === 3) // 3.複製+開啟Email (Yahoo Mail 亂碼，使用者可直接貼上)
  {showLiveToast("✅ 已複製清單！若郵件內文亂碼請直接貼上");
    const mailUrl = `mailto:may11051105@gmail.com?subject=${encodeURIComponent("金庸商城訂單")}&body=${encodeURIComponent(text)}`; 
    window.location.href = mailUrl;} // 直接調用，不需動態創建 <a> 標籤
}


// ==============================================
// 產生訂單文字檔
// ==============================================
function buildOrderText() {
  const user = document.getElementById("user-id")?.value || "👶";
  const pay = document.getElementById("pay-method")?.value || "💰";
  const memo = document.getElementById("order-memo")?.value || "💯";
  let itemText = "";
  let total = 0;
  let index = 1;
  let totalQty = 0;

  for (let name in selectedItems) {
    const qty = selectedItems[name];
    const price = priceLookup[name];
    if (qty > 0 && price !== undefined) {
      const sub = qty * price;
      itemText += `${index}●${name} ${qty} x${price}=${sub}\n`;
      index++;
      totalQty += qty;
      total += sub;
    }
  }
  if (!itemText) return null;

  let totalDisplay = total.toLocaleString();

  if (pay === "無卡存") {
    const discounted = Math.round(total * 0.95);
    const roundedHundred = Math.ceil(discounted / 100) * 100;
    totalDisplay = `${total}(ATM存款)= ${roundedHundred} 元`;
  } else if (pay === "支付寶") {
    totalDisplay = `${total} /4= ¥${Math.round(total / 4)}`;
  } else if (pay === "轉帳" || pay === "LinePay" || pay === "街口支付") {
    totalDisplay = `${total}x0.95= ${Math.round(total * 0.95)} 元\n(已享95折)`;
  }

  return `補給單📢傳給百分百以確認交易\n🌐${CONFIG.serverName}▬角色：${user}\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n${itemText}▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n備註：${memo}\n交易：${pay}\n總計：${index - 1}項 / ${totalQty}個\n總額：$${totalDisplay}`;
} //`


// ==============================================
//--  付款指引 -開啟Modal
// ==============================================
function openPaymentModal() {
  if (window.event) window.event.stopPropagation();

  const text = buildOrderText();
  //if (!text) return alert("尚未選擇商品！");

  const pay = document.getElementById("pay-method")?.value;
  
   //-- 付款方式：未達滿額時阻擋
  const total = Number(document.getElementById("total-val")?.textContent || 0 );
  if (
    (pay === "海外刷卡" || pay === "Paypal") &&
    total < 300
  ) {
  alert(`${pay} 需滿 $300 才能付款！\n\n目前訂單金額：$${total}\n\n請增加商品或更換其他交易方式。`);//`
    return; }
  
  const modal = document.getElementById("payment-modal");
  const orderTextArea = document.getElementById("modal-order-text");
  const instructionDiv = document.getElementById("payment-instruction");

  if (!modal) return;
  if (orderTextArea) {orderTextArea.value = text || "目前空空，無訂單，返回加入商品吧~";}
  
  let instructionHtml = "";
  switch (pay) {
  case "海外刷卡":
      instructionHtml = `💡 <b>海外線上刷卡 (滿300元)：</b><br>
                       點按鈕將清單傳至 百分百。下方連結可刷卡付款<br>
                       🔗 <a href="https://www.paypal.com/ncp/payment/UCXXH6EBEMRY2" target="_blank">👉 點此開啟海外刷卡頁面</a>`;
      break;
      
    case "Paypal":
      instructionHtml = `💡 <b>Paypal (滿300元) 付款指引：</b><br>
                       點按鈕將清單傳至 百分百。下方連結可開啟付款<br>
                       🔗 <a href="https://paypal.me/may11051105" target="_blank">👉 點此開啟 PayPal 支付</a>`;
      break;
      
    case "8591":
      instructionHtml = `💡 <b>8591 交易 (滿100元可開單)：</b><br>
                         點按鈕將清單傳至百分百，備註會員編號，將為您開專屬賣場！<br>
                         🔗 <a href="https://www.8591.com.tw/v3/mall/list/seller-809756" target="_blank">👉 開啟 8591 百分百賣場</a>`;
      break;
      
    case "無卡存":
      instructionHtml = `💡 <b>ATM 無卡存款 (百元單位)：</b><br>
                        請點擊下方按鈕將訂單傳送至 百分百，將提供存款帳號給您。`;
      break;
      
    case "街口支付": 
     instructionHtml = `💡 <b>街口支付(享95折)：</b><br>
                       點按鈕將清單傳至百分百，下方連結可開啟支付<br>
                      🔗 <a href="https://service.jkopay.com/r/transfer?j=Transfer:903887991" target="_blank">👉（機構代碼396）街口帳號 903887991</a>`;
      break;
      
    case "LinePay":
    case "轉帳":
      instructionHtml = `💡 <b>台灣即時支付 (享95折)：</b><br>請將訂單傳送至 百分百，將提供收款 Code / 帳號給您。`;
      break;
    default:
      instructionHtml = `💡 確認訂單無誤後，點擊下方按鈕將清單傳送至 百分百！`;
  }

  instructionDiv.innerHTML = instructionHtml;
  modal.style.display = "flex";
}

//-- 關閉彈窗: 通用關閉函數 (支援Modal彈窗與購物車抽屜)
function closeModal(target) {
  if (window.event) window.event.stopPropagation();
  const modal =
    typeof target === "string"
      ? document.getElementById(target)
      : target
        ? target.closest(".modal-overlay, #cart-wrapper")
        : null;

  if (!modal) return;
  if (modal.classList.contains("modal-overlay")) {modal.style.display = "none"; }
  if (modal.id === "cart-wrapper" || modal.closest("#cart-wrapper")) {
    const cartWrapper = document.getElementById("cart-wrapper");
    cartWrapper.classList.remove("expanded");
    cartWrapper.style.display = ""; }
}

//-- 分享送出訂單 (按鈕點擊時觸發)
async function submitOrder() {
  if (window.event) window.event.stopPropagation();

  //若休站中
  if (isStoreClosed) {alert("目前小站休息中，暫時無法下單！");
    return; }
  
  const text = buildOrderText();
  if (!text) return alert("尚未選擇商品！");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => {}); }
  closeModal();
  window.open(`https://line.me/R/msg/text/${encodeURIComponent(text)}`,"_blank",);
}




// ==============================================
// 每日訪客：同裝置一天只計一次
// ==============================================
function recordDailyVisitor() {
  const node = CONFIG.firebaseNode;
  const today = new Date();
  const todayKey =
    today.getFullYear() +
    '-' +
    String(today.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(today.getDate()).padStart(2, '0');

  const visitorKey = `jin_mall_visitor_${node}`;
  const lastVisitDate = getSafeCache(visitorKey);
  const visitorRef = dbFirebase.ref(`settings/visitor/${node}`);

  // 今天已經記錄過
  if (lastVisitDate === todayKey) {
    visitorRef.once('value').then((snapshot) => {
      updateVisitorDisplay(snapshot.val());
    });
    return;
  }

  // 今天還沒記錄 → +1
  visitorRef
    .transaction((currentValue) => {
      return (Number(currentValue) || 0) + 1;
    })
    .then((result) => {
      setSafeCache(visitorKey, todayKey);
      updateVisitorDisplay(result.snapshot.val());
      console.log(`👤 今日訪客已記錄：[${node}]`);
    })
    .catch((error) => {
      console.warn('⚠️ 訪客統計失敗：', error);
    });
}

// 目前訪客數
function updateVisitorDisplay(count) {
  const el = document.getElementById('visitor-count');
  if (!el) return;
//el.textContent = Number(count) || 0; //純數字
  el.textContent = `➤${Number(count) || 0}`;
}


//-- TOP按鈕：監聽捲動事件，決定何時跳出按鈕
window.onscroll = function () {
  const btn = document.getElementById("btnTop");
  if (btn)
    btn.style.display =
      document.body.scrollTop > 300 || document.documentElement.scrollTop > 300
        ? "block"
        : "none";
};


//-- p99驗證
function checkPassword() {
  const input = document.getElementById("pwd").value.trim();
  if (input === String(secretPassword).trim()) {
    document.getElementById("secret-section").style.display = "block";
    document.getElementById("password-box").style.display = "none";
  } else {
    alert("密碼錯誤");
  }
}

//-- 🔔 休站公告.開關
function showMaintenance() {
  const overlay = document.getElementById("maintenance-overlay");
  if (overlay) {overlay.style.display = "flex"; }
}
function closeMaintenance() {
  const overlay = document.getElementById("maintenance-overlay");
  if (overlay) {overlay.style.display = "none"; }
}

//-- 🔃 重新整理按鈕
function refreshInventory() {
  const btn = document.getElementById("refresh-button");
  btn.classList.add("loading");
  btn.style.pointerEvents = "none";

  fetchLatestData()
    .then(() => {
      btn.classList.remove("loading");
      btn.style.pointerEvents = "auto";
      showRefreshToast("✅ 庫存已更新");
    })
    .catch((error) => {
      btn.classList.remove("loading");
      btn.style.pointerEvents = "auto";
      showRefreshToast("❌ 更新失敗，請檢查");
      console.error("更新失敗:", error);
    });
}

//-- 浮動訊息
function showRefreshToast(message) {
  const toast = document.createElement("div");
  toast.textContent = message;
  toast.style.cssText = `
              position: fixed;
              bottom: 100px;
              right: 20px;
              background: rgba(0, 0, 0, 0.8);
              color: white;
              padding: 12px 20px;
              border-radius: 8px;
              font-size: 14px;
              z-index: 100000;
              animation: slideIn 0.3s ease;
          `;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = "slideOut 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

//--資料更新浮動提示
function showLiveToast(message = "⚡ 商品資料已更新") {
  const toast = document.getElementById("live-toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2000);
}

// ==============================================
//-- 初始化設定
// ==============================================
document.title = `【百分百】金庸商城 - ${CONFIG.serverId}區`;

//-- DOM 載入完成後執行的初始化與監聽
window.addEventListener('DOMContentLoaded', () => {
  // 1. 修改 Header 標題
  const h1 = document.querySelector("header h1");
  if (h1) {h1.textContent = `${CONFIG.serverName}${h1.textContent}`;}

  // 2. 角色名稱 LocalStorage 自動記憶邏輯
  const userIdInput = document.getElementById("user-id");
  if (userIdInput) {
    // 頁面載入時：自動填入上次存下的角色名
    const savedName = localStorage.getItem("shop_saved_user_id");
    if (savedName) {userIdInput.value = savedName;}

    // 當玩家輸入或修改名字時：即時儲存至 localStorage
    userIdInput.addEventListener("input", () => {
      localStorage.setItem("shop_saved_user_id", userIdInput.value.trim());
    });
  }

  // 3. 讀取提示文字 
  const loadingToast = document.getElementById("loading-toast");
  if (loadingToast) {
    loadingToast.innerHTML = `獲取最新資料中<span class="bounce">${CONFIG.loadingText}</span>`;}
    
 // 3. 付款方式 LocalStorage 自動記憶
const payMethod = document.getElementById("pay-method");
if (payMethod) {
  // 頁面載入時：自動填入上次選擇的付款方式
  const savedPayMethod = localStorage.getItem("shop_saved_pay_method");
  if (savedPayMethod) {payMethod.value = savedPayMethod;}
  // 當更改付款方式時：立即更新
  payMethod.addEventListener("change", () => {
  setSafeCache("shop_saved_pay_method", payMethod.value);
  updateTotal();
  });
} 
  updateCart();//購物車畫面初始化
});


// 4. Firebase 動態監聽 + 提示
let isInitialLoad = true;
dbFirebase.ref(CONFIG.firebaseNode).on("value", (snapshot) => {
  const data = snapshot.val();
  if (!data) return;
  const dataArray = Array.isArray(data) ? data : Object.values(data);
  const cacheKey = CONFIG.cacheKey || "jin_mall_products";
  localStorage.setItem(cacheKey, JSON.stringify(dataArray));
  processData(dataArray);
  render();
  if (isInitialLoad) {
    isInitialLoad = false;
  } else {showLiveToast();}
});


// ==============================================
//-- 全站共用 Alert
//-- alert() 自動套用商城風格
// ==============================================
(function () {
  const alertBox = document.getElementById("custom-alert");
  const alertMessage = document.getElementById("custom-alert-message");
  const alertOK = document.getElementById("custom-alert-ok");
  if (!alertBox || !alertMessage || !alertOK) return;

  //-- 共用關閉
  function closeAlert() {alertBox.classList.remove("show");}
 //接管原生 alert()
 window.alert = function (message) {
    alertMessage.textContent = message ?? "";
    alertBox.classList.add("show");
    setTimeout(() => {alertOK.focus(); }, 50); };
  //Alert 確定
  alertOK.addEventListener("click", closeAlert);
  //點擊遮罩關閉
  alertBox.addEventListener("click", function (event) {
    if (event.target === alertBox) {closeAlert();  }
  });
  //ESC 關閉
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" &&
      alertBox.classList.contains("show")
    ) {closeAlert(); }
  });
})();


loadSettings();
loadProducts(); // 畫面初始化
