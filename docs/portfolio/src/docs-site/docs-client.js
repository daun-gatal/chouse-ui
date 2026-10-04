/**
 * docs-client.js — progressive enhancement for the static docs pages.
 * No framework: scrollspy for the "On this page" rail, copy buttons for code
 * blocks, the mobile sidebar drawer, tabbed blocks and search. Loaded with
 * defer on docs pages only.
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


  /* ---------------- Tabs ---------------- */

  /**
   * Switch tabbed alternatives. The choice is remembered per label set
   * (data-tabs-key), so picking "Helm" once applies to every Docker/Helm
   * block on every page.
   */
  var TAB_STORE = "chouse-docs-tabs:";

  function readStore(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeStore(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* storage blocked — the choice just isn't remembered */
    }
  }

  function selectTab(group, label) {
    var found = false;
    group.querySelectorAll("[data-tab]").forEach(function (tab) {
      if (tab.getAttribute("data-tab") === label) found = true;
    });
    if (!found) return;
    group.querySelectorAll("[data-tab]").forEach(function (tab) {
      tab.setAttribute("aria-selected", tab.getAttribute("data-tab") === label ? "true" : "false");
    });
    group.querySelectorAll("[data-tab-panel]").forEach(function (panel) {
      panel.hidden = panel.getAttribute("data-tab-panel") !== label;
    });
  }

  function setupTabs() {
    var groups = Array.prototype.slice.call(document.querySelectorAll("[data-tabs]"));
    groups.forEach(function (group) {
      var key = group.getAttribute("data-tabs-key");
      var stored = readStore(TAB_STORE + key);
      if (stored) selectTab(group, stored);
      group.querySelectorAll("[data-tab]").forEach(function (tab) {
        tab.addEventListener("click", function () {
          var label = tab.getAttribute("data-tab");
          writeStore(TAB_STORE + key, label);
          groups.forEach(function (other) {
            if (other.getAttribute("data-tabs-key") === key) selectTab(other, label);
          });
        });
      });
    });
  }

  /* ---------------- Search ---------------- */

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function tokenize(query) {
    return query
      .toLowerCase()
      .split(/[^a-z0-9_:.-]+/)
      .filter(function (t) {
        return t.length > 0;
      });
  }

  /** Points for one token in one field: whole-word and prefix hits beat substrings. */
  function fieldScore(field, token, weight) {
    if (!field) return 0;
    var idx = field.indexOf(token);
    if (idx === -1) return 0;
    var start = idx === 0 || /[^a-z0-9]/.test(field.charAt(idx - 1));
    var end = idx + token.length === field.length || /[^a-z0-9]/.test(field.charAt(idx + token.length));
    return weight * (start && end ? 3 : start ? 2 : 1);
  }

  function prepare(index) {
    return index.chunks.map(function (chunk) {
      var page = index.pages[chunk.p];
      return {
        page: page,
        chunk: chunk,
        title: page.t.toLowerCase(),
        heading: (chunk.h || "").toLowerCase(),
        meta: [page.d, page.g, page.a || "", (page.p || []).join(" ")].join(" ").toLowerCase(),
        text: chunk.x.toLowerCase(),
      };
    });
  }

  function search(entries, query) {
    var tokens = tokenize(query);
    if (tokens.length === 0) return { results: [], tokens: tokens };
    var hits = [];
    entries.forEach(function (entry) {
      var total = 0;
      for (var i = 0; i < tokens.length; i++) {
        var t = tokens[i];
        var score =
          fieldScore(entry.title, t, 10) +
          fieldScore(entry.heading, t, 6) +
          fieldScore(entry.meta, t, 2) +
          fieldScore(entry.text, t, 1);
        if (score === 0) return; // every token must match somewhere
        total += score;
      }
      // A page's intro chunk carries the page itself; nudge it above its sections.
      if (!entry.chunk.a) total += 1;
      hits.push({ entry: entry, score: total });
    });
    hits.sort(function (a, b) {
      return b.score - a.score;
    });
    // At most three sections per page, twenty results overall.
    var perPage = {};
    var out = [];
    for (var j = 0; j < hits.length && out.length < 20; j++) {
      var slug = hits[j].entry.page.s;
      perPage[slug] = (perPage[slug] || 0) + 1;
      if (perPage[slug] <= 3) out.push(hits[j].entry);
    }
    return { results: out, tokens: tokens };
  }

  /** ~160 characters around the first match, with every token highlighted. */
  function snippet(text, tokens) {
    var lower = text.toLowerCase();
    var first = -1;
    tokens.forEach(function (t) {
      var i = lower.indexOf(t);
      if (i !== -1 && (first === -1 || i < first)) first = i;
    });
    var start = Math.max(0, first - 50);
    var piece = text.slice(start, start + 160);
    var html = escapeHtml(piece);
    tokens.forEach(function (t) {
      var re = new RegExp("(" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
      html = html.replace(re, '<mark class="bg-accent/20 text-paper rounded-xs">$1</mark>');
    });
    return (start > 0 ? "… " : "") + html + (start + 160 < text.length ? " …" : "");
  }

  function setupSearch() {
    var dialog = document.getElementById("docs-search");
    if (!dialog) return;
    var input = dialog.querySelector("[data-search-input]");
    var list = dialog.querySelector("[data-search-results]");
    var status = dialog.querySelector("[data-search-status]");
    var base = dialog.getAttribute("data-docs-base");
    var entries = null;
    var loading = null;
    var active = 0;
    var lastFocus = null;

    function load() {
      if (entries || loading) return loading;
      loading = fetch(dialog.getAttribute("data-search-index"))
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        })
        .then(function (index) {
          entries = prepare(index);
          run();
        })
        .catch(function () {
          status.textContent = "Search is unavailable right now — use the sidebar.";
        });
      return loading;
    }

    function render(results, tokens) {
      active = 0;
      if (results.length === 0) {
        list.innerHTML =
          '<li class="px-3 py-6 text-center text-[13.5px] text-paper-dim">No results. Try a setting name, permission or error code.</li>';
        return;
      }
      list.innerHTML = results
        .map(function (r, i) {
          var href = base + r.page.s + "/" + (r.chunk.a ? "#" + r.chunk.a : "");
          var title = escapeHtml(r.page.t) + (r.chunk.h ? ' <span class="text-paper-faint">›</span> ' + escapeHtml(r.chunk.h) : "");
          var body = r.chunk.x ? snippet(r.chunk.x, tokens) : escapeHtml(r.page.d);
          return (
            '<li role="option" data-search-item="' + i + '" aria-selected="' + (i === 0) + '">' +
            '<a href="' + href + '" class="block rounded-xs px-3 py-2.5 transition-colors">' +
            '<span class="block font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">' + escapeHtml(r.page.g) + "</span>" +
            '<span class="mt-0.5 block text-[14px] font-medium text-paper">' + title + "</span>" +
            '<span class="mt-1 block text-[12.5px] leading-relaxed text-paper-dim">' + body + "</span>" +
            "</a></li>"
          );
        })
        .join("");
      highlight();
    }

    function highlight() {
      list.querySelectorAll("[data-search-item]").forEach(function (item, i) {
        var on = i === active;
        item.setAttribute("aria-selected", on ? "true" : "false");
        var link = item.querySelector("a");
        link.classList.toggle("bg-ink-300", on);
        if (on) item.scrollIntoView({ block: "nearest" });
      });
    }

    function run() {
      var query = input.value.trim();
      if (!query) {
        list.innerHTML = "";
        status.textContent = "Type to search · ↑↓ to move · Enter to open";
        return;
      }
      if (!entries) {
        status.textContent = "Loading search index…";
        return;
      }
      var found = search(entries, query);
      render(found.results, found.tokens);
      status.textContent = found.results.length + (found.results.length === 1 ? " result" : " results") + " · ↑↓ to move · Enter to open";
    }

    function open() {
      lastFocus = document.activeElement;
      dialog.classList.remove("hidden");
      document.body.style.overflow = "hidden";
      input.focus();
      input.select();
      load();
    }

    function close() {
      dialog.classList.add("hidden");
      document.body.style.overflow = "";
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    document.querySelectorAll("[data-search-open]").forEach(function (btn) {
      btn.addEventListener("click", open);
    });
    dialog.querySelectorAll("[data-search-close]").forEach(function (btn) {
      btn.addEventListener("click", close);
    });
    input.addEventListener("input", run);
    input.addEventListener("keydown", function (e) {
      var items = list.querySelectorAll("[data-search-item]");
      if (e.key === "ArrowDown" && items.length) {
        e.preventDefault();
        active = (active + 1) % items.length;
        highlight();
      } else if (e.key === "ArrowUp" && items.length) {
        e.preventDefault();
        active = (active - 1 + items.length) % items.length;
        highlight();
      } else if (e.key === "Enter" && items.length) {
        e.preventDefault();
        var link = items[active].querySelector("a");
        close();
        window.location.href = link.getAttribute("href");
      }
    });
    list.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("a")) close();
    });
    document.addEventListener("keydown", function (e) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (dialog.classList.contains("hidden")) open();
        else close();
      } else if (e.key === "/" && !typing && dialog.classList.contains("hidden")) {
        e.preventDefault();
        open();
      } else if (e.key === "Escape" && !dialog.classList.contains("hidden")) {
        close();
      }
    });
  }

  function init() {
    scrollActiveSidebarItems();
    setupDrawer();
    setupCopy();
    setupScrollspy();
    setupTabs();
    setupSearch();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
