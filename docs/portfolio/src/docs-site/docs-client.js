/**
 * docs-client.js — progressive enhancement for the static docs pages.
 * No framework: scrollspy for the "On this page" rail, copy buttons for code
 * blocks, and the mobile sidebar drawer. Loaded with defer on docs pages only.
 */
(function () {
  "use strict";

  /* ---------------- Sidebar scroll persistence ---------------- */

  /**
   * Keep the active sidebar item in view. Pages are full page loads, so the
   * sidebar re-renders scrolled to top on every navigation — without this the
   * left rail "jumps back to top" and the active entry can sit off-screen.
   * Adjusts only the sidebar's own scroll container (desktop rail or drawer),
   * never the page itself.
   */
  function keepActiveSidebarInView(link) {
    // Walk up to the nearest scrollable ancestor (the sidebar container).
    var node = link.parentElement;
    while (node && node !== document.body) {
      var style = window.getComputedStyle(node);
      if (style.overflowY === "auto" || style.overflowY === "scroll") break;
      node = node.parentElement;
    }
    if (!node || node === document.body) return;

    var containerRect = node.getBoundingClientRect();
    var linkRect = link.getBoundingClientRect();
    // Hidden elements (the closed drawer) report zero rects — safe no-op.
    if (containerRect.height === 0 || linkRect.height === 0) return;
    if (linkRect.top < containerRect.top || linkRect.bottom > containerRect.bottom) {
      node.scrollTop += linkRect.top - containerRect.top - 12;
    }
  }

  function scrollActiveSidebarItems(root) {
    var scope = root || document;
    scope.querySelectorAll("a[aria-current='page']").forEach(function (link) {
      keepActiveSidebarInView(link);
    });
  }

  /* ---------------- Mobile drawer ---------------- */
  function setupDrawer() {
    var drawer = document.getElementById("docs-drawer");
    if (!drawer) return;
    document.querySelectorAll("[data-drawer-toggle]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        drawer.classList.remove("hidden");
        document.body.style.overflow = "hidden";
        var active = drawer.querySelector("a[aria-current='page']");
        if (active) keepActiveSidebarInView(active);
      });
    });
    drawer.querySelectorAll("[data-drawer-close]").forEach(function (btn) {
      btn.addEventListener("click", close);
    });
    drawer.querySelectorAll("a[href]").forEach(function (link) {
      link.addEventListener("click", close);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
    });
    function close() {
      drawer.classList.add("hidden");
      document.body.style.overflow = "";
    }
  }

  /* ---------------- Copy buttons ---------------- */
  function setupCopy() {
    document.querySelectorAll("[data-docs-copy]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var wrap = btn.closest("[data-code-wrap]");
        var codeEl = wrap ? wrap.querySelector("code") : null;
        if (!codeEl) return;
        var label = btn.querySelector("[data-docs-copy-label]");
        var original = label ? label.textContent : "Copy";
        var done = function () {
          if (!label) return;
          label.textContent = "Copied";
          btn.classList.add("text-accent");
          window.setTimeout(function () {
            label.textContent = original;
            btn.classList.remove("text-accent");
          }, 1800);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(codeEl.textContent || "").then(done, done);
        } else {
          var range = document.createRange();
          range.selectNodeContents(codeEl);
          var selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          try {
            document.execCommand("copy");
          } catch {
            /* no-op */
          }
          selection.removeAllRanges();
          done();
        }
      });
    });
  }

  /* ---------------- TOC scrollspy ---------------- */
  function setupScrollspy() {
    var tocLinks = Array.prototype.slice.call(document.querySelectorAll("[data-toc-link]"));
    if (tocLinks.length === 0 || !("IntersectionObserver" in window)) return;
    var byId = {};
    tocLinks.forEach(function (link) {
      var id = link.getAttribute("data-toc-link");
      byId[id] = link;
    });
    var headings = Array.prototype.slice
      .call(document.querySelectorAll("main h2[id], main h3[id]"))
      .filter(function (h) {
        return byId[h.id];
      });
    if (headings.length === 0) return;
    var activeId = null;

    var observer = new IntersectionObserver(
      function (entries) {
        var visible = entries
          .filter(function (entry) {
            return entry.isIntersecting;
          })
          .sort(function (a, b) {
            return a.boundingClientRect.top - b.boundingClientRect.top;
          });
        if (visible.length > 0) setActive(visible[0].target.id);
      },
      { rootMargin: "-12% 0px -72% 0px", threshold: 0 }
    );
    headings.forEach(function (h) {
      observer.observe(h);
    });

    function setActive(id) {
      if (id === activeId) return;
      activeId = id;
      tocLinks.forEach(function (link) {
        var isActive = link.getAttribute("data-toc-link") === id;
        link.classList.toggle("text-paper", isActive);
        link.classList.toggle("border-accent", isActive);
        if (isActive) {
          link.style.borderLeftColor = "#FFCC01";
          link.style.color = "#fafafa";
        } else {
          link.style.borderLeftColor = "";
          link.style.color = "";
        }
      });
    }
  }

  function init() {
    scrollActiveSidebarItems();
    setupDrawer();
    setupCopy();
    setupScrollspy();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
