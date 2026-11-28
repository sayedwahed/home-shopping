/* Home Shopping cart drawer (client-side only).
   Cart lives in localStorage. Checkout always happens on AliExpress:
   every cart item links to /go/<id>, the disclosure page, never
   directly to an affiliate URL. */
(function () {
  "use strict";

  var KEY = "hs-cart";

  function getCart() {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]"); }
    catch (e) { return []; }
  }
  function setCart(c) {
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {}
    updateBadge();
  }
  function money(n) { return "$" + Number(n).toFixed(2); }

  function updateBadge() {
    var n = 0;
    getCart().forEach(function (i) { n += i.qty; });
    var el = document.getElementById("cartCount");
    if (!el) return;
    el.style.display = n ? "flex" : "none";
    el.textContent = n;
  }

  function renderCart() {
    var box = document.getElementById("cartItems");
    if (!box) return;
    box.innerHTML = "";
    var cart = getCart();
    var total = 0;
    if (!cart.length) {
      var e = document.createElement("div");
      e.className = "empty";
      e.textContent = "Your cart is empty — add products from the store.";
      box.appendChild(e);
    }
    cart.forEach(function (item) {
      total += item.price * item.qty;
      var row = document.createElement("div");
      row.className = "ci";
      if (item.image) {
        var im = document.createElement("img");
        im.src = item.image; im.alt = "";
        row.appendChild(im);
      }
      var mid = document.createElement("div");
      mid.style.flex = "1";
      var nm = document.createElement("div");
      nm.className = "nm";
      nm.textContent = item.title + " × " + item.qty;
      var lk = document.createElement("a");
      lk.href = "/go/" + item.id;
      lk.textContent = "Buy on AliExpress";
      lk.style.cssText = "font-size:12px;color:#e62e04;font-weight:bold";
      var rm = document.createElement("button");
      rm.type = "button"; rm.className = "rm"; rm.textContent = "Remove";
      rm.addEventListener("click", function () {
        setCart(getCart().filter(function (x) { return x.id !== item.id; }));
        renderCart();
      });
      mid.appendChild(nm);
      mid.appendChild(lk);
      mid.appendChild(document.createElement("br"));
      mid.appendChild(rm);
      var pr = document.createElement("div");
      pr.className = "pr";
      pr.textContent = money(item.price * item.qty);
      row.appendChild(mid);
      row.appendChild(pr);
      box.appendChild(row);
    });
    var totalEl = document.getElementById("cartTotal");
    if (totalEl) totalEl.textContent = money(total);
  }

  function openDrawer() {
    renderCart();
    document.getElementById("drawer").classList.remove("hidden");
    document.getElementById("overlay").classList.remove("hidden");
  }
  function closeDrawer() {
    document.getElementById("drawer").classList.add("hidden");
    document.getElementById("overlay").classList.add("hidden");
  }

  document.addEventListener("DOMContentLoaded", function () {
    updateBadge();
    var cartBtn = document.getElementById("cartBtn");
    if (cartBtn) cartBtn.addEventListener("click", openDrawer);
    var closeBtn = document.getElementById("drawerClose");
    if (closeBtn) closeBtn.addEventListener("click", closeDrawer);
    var overlay = document.getElementById("overlay");
    if (overlay) overlay.addEventListener("click", closeDrawer);

    document.querySelectorAll("[data-add-to-cart]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var item = {
          id: btn.getAttribute("data-id"),
          title: btn.getAttribute("data-title"),
          price: parseFloat(btn.getAttribute("data-price")),
          image: btn.getAttribute("data-image") || ""
        };
        var cart = getCart();
        var found = null;
        cart.forEach(function (x) { if (x.id === item.id) found = x; });
        if (found) found.qty += 1;
        else { item.qty = 1; cart.push(item); }
        setCart(cart);
        var original = btn.textContent;
        btn.textContent = "Added to cart ✓";
        setTimeout(function () { btn.textContent = original; }, 1200);
      });
    });
  });
})();
