"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type FormState = {
  url: string;
  name: string;
  css_hint: string;
  region: "us" | "eu";
  email: string;
  node_index: number | null; // 1-based index among matches
};

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; html: string; baseUrl: string }
  | { status: "error"; message: string };

function getOriginHref(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return u.href;
  } catch {
    return rawUrl;
  }
}

/**
 * Script injected into the iframe.
 * Implemented as joined lines to avoid template-literal escaping issues.
 */
const INJECTED_PICKER_JS = [
  "(function(){",
  "  function cssEsc(str){",
  "    str = String(str);",
  "    var out = '';",
  "    for (var i=0;i<str.length;i++){",
  "      var ch = str.charAt(i);",
  "      var code = ch.charCodeAt(0);",
  "      if ((code>=48 && code<=57) || (code>=65 && code<=90) || (code>=97 && code<=122) || ch==='_' || ch==='-'){",
  "        out += ch;",
  "      } else {",
  "        var hex = code.toString(16).toUpperCase();",
  "        if (hex.length<2) hex = '0'+hex;",
  "        out += '\\\\' + hex + ' ';",
  "      }",
  "    }",
  "    if (/^[0-9]/.test(out)) out = '\\\\3' + out.charAt(0) + ' ' + out.slice(1);",
  "    return out;",
  "  }",
  "",
  "  var body = document.body || document.createElement('body');",
  "",
  "  var hiBox = document.createElement('div');",
  "  hiBox.style.position = 'fixed';",
  "  hiBox.style.left = '0px';",
  "  hiBox.style.top = '0px';",
  "  hiBox.style.width = '0px';",
  "  hiBox.style.height = '0px';",
  "  hiBox.style.border = '2px solid rgba(96,165,250,1)';",
  "  hiBox.style.borderRadius = '10px';",
  "  hiBox.style.background = 'rgba(96,165,250,0.08)';",
  "  hiBox.style.boxShadow = '0 10px 30px rgba(51,65,85,.25), inset 0 0 0 1px rgba(96,165,250,.35)';",
  "  hiBox.style.pointerEvents = 'none';",
  "  hiBox.style.opacity = '0';",
  "  hiBox.style.zIndex = '2147483645';",
  "",
  "  var label = document.createElement('div');",
  "  label.style.position = 'fixed';",
  "  label.style.transform = 'translateY(-8px)';",
  "  label.style.background = 'rgba(17,24,39,.88)';",
  "  label.style.color = '#e5e7eb';",
  "  label.style.border = '1px solid rgba(255,255,255,.16)';",
  "  label.style.borderRadius = '8px';",
  "  label.style.padding = '4px 8px';",
  "  label.style.fontSize = '12px';",
  "  label.style.whiteSpace = 'nowrap';",
  "  label.style.pointerEvents = 'none';",
  "  label.style.opacity = '0';",
  "  label.style.zIndex = '2147483646';",
  "",
  "  body.appendChild(hiBox);",
  "  body.appendChild(label);",
  "",
  "  var active = false;",
  "  var lockedEl = null;",
  "",
  "  function computeSelector(el){",
  "    if(!el || el.nodeType!==1) return null;",
  "    if (el.id){",
  "      return '#' + cssEsc(el.id);",
  "    }",
  "    var className = (el.getAttribute('class') || '').trim();",
  "    var classes = className ? className.split(/\\s+/).filter(Boolean) : [];",
  "    if (classes.length){",
  "      return el.tagName.toLowerCase() + '.' + classes.slice(0,3).map(cssEsc).join('.');",
  "    }",
  "    var parent = el.parentElement;",
  "    var seg = el.tagName.toLowerCase();",
  "    if (parent){",
  "      var siblings = Array.prototype.filter.call(parent.children, function(ch){ return ch.tagName===el.tagName; });",
  "      if (siblings.length>1){",
  "        var idx = Array.prototype.indexOf.call(siblings, el)+1;",
  "        seg += ':nth-of-type(' + idx + ')';",
  "      }",
  "    }",
  "    return seg;",
  "  }",
  "",
  "  function computeIndexAndTotal(sel, el){",
  "    try{",
  "      var list = Array.prototype.slice.call(document.querySelectorAll(sel));",
  "      return { index: list.indexOf(el), total: list.length };",
  "    }catch(e){",
  "      return { index: -1, total: 0 };",
  "    }",
  "  }",
  "",
  "  function moveBoxTo(target){",
  "    if(!target){",
  "      hiBox.style.opacity='0';",
  "      label.style.opacity='0';",
  "      return;",
  "    }",
  "    var r = target.getBoundingClientRect();",
  "    hiBox.style.left = (r.left-2)+'px';",
  "    hiBox.style.top = (r.top-2)+'px';",
  "    hiBox.style.width = (Math.max(4, r.width+4))+'px';",
  "    hiBox.style.height = (Math.max(4, r.height+4))+'px';",
  "    hiBox.style.opacity = '1';",
  "    label.textContent = target.tagName.toLowerCase() + (target.id ? '#' + target.id : '');",
  "    label.style.left = (Math.max(8, r.left + r.width - (label.offsetWidth||0) - 6)) + 'px';",
  "    label.style.top = (Math.max(8, r.top - 10)) + 'px';",
  "    label.style.opacity = '1';",
  "  }",
  "",
  "  function onMove(e){",
  "    if(!active) return;",
  "    var path = e.composedPath ? e.composedPath() : null;",
  "    var el = path && path.length ? path[0] : e.target;",
  "    if(el===document.documentElement || el===document.body) el = null;",
  "    var sel = el ? computeSelector(el) : null;",
  "    moveBoxTo(lockedEl || el || null);",
  "    if(sel){",
  "      try { window.parent.postMessage({ type:'PICKER_UPDATE', selector: sel, text: el ? (el.innerText || '') : '' }, '*'); } catch (err) {}",
  "    }",
  "  }",
  "",
  "  function onClick(e){",
  "    if(!active) return;",
  "    e.preventDefault(); e.stopPropagation();",
  "    var path = e.composedPath ? e.composedPath() : null;",
  "    var el = path && path.length ? path[0] : e.target;",
  "    if(!el || el===document.documentElement || el===document.body) return;",
  "    lockedEl = el;",
  "    var sel = computeSelector(el);",
  "    moveBoxTo(el);",
  "    if(sel){",
  "      var info = computeIndexAndTotal(sel, el);",
  "      try {",
  "        window.parent.postMessage({",
  "          type:'PICKER_LOCK',",
  "          selector: sel,",
  "          text: el.innerText || '',",
  "          index: info.index,",
  "          total: info.total",
  "        }, '*');",
  "      } catch (err) {}",
  "    }",
  "  }",
  "",
  "  function onKey(e){",
  "    if(!active) return;",
  "    if(e.key==='Escape'){",
  "      e.preventDefault();",
  "      active=false; lockedEl=null; moveBoxTo(null);",
  "      try { window.parent.postMessage({type:'PICKER_CANCELLED'}, '*'); } catch (err) {}",
  "    } else if((e.key==='Backspace' || e.key==='ArrowLeft') && lockedEl && lockedEl.parentElement){",
  "      var parent = lockedEl.parentElement;",
  "      lockedEl = parent;",
  "      var sel = computeSelector(parent);",
  "      moveBoxTo(parent);",
  "      if(sel){",
  "        var info2 = computeIndexAndTotal(sel, parent);",
  "        try {",
  "          window.parent.postMessage({",
  "            type:'PICKER_LOCK',",
  "            selector: sel,",
  "            text: parent.innerText || '',",
  "            index: info2.index,",
  "            total: info2.total",
  "          }, '*');",
  "        } catch (err) {}",
  "      }",
  "    } else if(e.key==='Enter' && lockedEl){",
  "      e.preventDefault();",
  "      var s = computeSelector(lockedEl);",
  "      if(s){",
  "        var info3 = computeIndexAndTotal(s, lockedEl);",
  "        try {",
  "          window.parent.postMessage({",
  "            type:'PICKER_CONFIRM',",
  "            selector: s,",
  "            index: info3.index,",
  "            total: info3.total",
  "          }, '*');",
  "        } catch (err) {}",
  "      }",
  "      active=false;",
  "    }",
  "  }",
  "",
  "  window.addEventListener('message', function(e){",
  "    var data = e && e.data;",
  "    if(!data || typeof data!=='object') return;",
  "    if(data.type==='PICKER_SET_ACTIVE'){",
  "      active = !!data.active;",
  "      if(!active){ lockedEl=null; moveBoxTo(null); }",
  "      try { document.body.setAttribute('tabindex','-1'); document.body.focus({preventScroll:true}); } catch (err) {}",
  "    }",
  "  });",
  "",
  "  document.addEventListener('mousemove', onMove, true);",
  "  document.addEventListener('click', onClick, true);",
  "  document.addEventListener('keydown', onKey, true);",
  "",
  "})();",
].join("\n");

function buildSrcdoc(html: string, baseHref: string): string {
  let s = html;

  if (!/<head[\s>]/i.test(s)) {
    s = s.replace(/<html[\s>]/i, (m) => m + "<head></head>");
    if (!/<head[\s>]/i.test(s)) {
      s = "<html><head></head><body>" + s + "</body></html>";
    }
  }

  s = s.replace(
    /<head([^>]*)>/i,
    (m, attrs) => "<head" + attrs + '><base href="' + baseHref + '">'
  );

  s = s.replace(
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    ""
  );

  if (/<\/body>/i.test(s)) {
    s = s.replace(
      /<\/body>/i,
      "<script>" + INJECTED_PICKER_JS + "</script></body>"
    );
  } else {
    s = s + "<script>" + INJECTED_PICKER_JS + "</script>";
  }

  return s;
}

export default function MonitorForm() {
  const [form, setForm] = useState<FormState>({
    url: "",
    name: "",
    css_hint: "",
    region: "us",
    email: "",
    node_index: 1,
  });

  const [loading, setLoading] = useState(false);
  const [fetchState, setFetchState] = useState<FetchState>({ status: "idle" });
  const [pickerActive, setPickerActive] = useState(false);
  const [hoverSelector, setHoverSelector] = useState<string>("");
  const [lockedSelector, setLockedSelector] = useState<string>("");
  const [lockedIndex, setLockedIndex] = useState<number | null>(1);
  const [totalMatches, setTotalMatches] = useState<number | null>(null);
  const [previewHeight, setPreviewHeight] = useState<number>(920);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const pickingRef = useRef(false);

  const srcdoc = useMemo(() => {
    if (fetchState.status !== "loaded") return "";
    return buildSrcdoc(fetchState.html, fetchState.baseUrl);
  }, [fetchState]);

  useEffect(() => {
    pickingRef.current = pickerActive;
  }, [pickerActive]);

  useEffect(() => {
    const original = document.documentElement.style.overflow;
    if (isFullscreen) {
      document.documentElement.style.overflow = "hidden";
    } else {
      document.documentElement.style.overflow = original || "";
    }
    return () => {
      document.documentElement.style.overflow = original || "";
    };
  }, [isFullscreen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isFullscreen && e.key === "Escape" && !pickingRef.current) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const iframe = iframeRef.current;
      if (!iframe || e.source !== iframe.contentWindow) return;
      const data = e.data as any;
      if (!data || typeof data !== "object") return;

      if (data.type === "PICKER_UPDATE") {
        if (pickingRef.current && typeof data.selector === "string") {
          setHoverSelector(data.selector);
        }
      } else if (data.type === "PICKER_LOCK") {
        if (typeof data.selector === "string") {
          setLockedSelector(data.selector);
          const idx0 =
            typeof data.index === "number" && data.index >= 0
              ? data.index
              : 0;
          const idx1 = idx0 + 1;
          setLockedIndex(idx1);
          const total =
            typeof data.total === "number" && data.total > 0
              ? data.total
              : null;
          setTotalMatches(total);
        }
      } else if (data.type === "PICKER_CONFIRM") {
        if (typeof data.selector === "string") {
          const idx0 =
            typeof data.index === "number" && data.index >= 0
              ? data.index
              : 0;
          const idx1 = idx0 + 1;
          setLockedSelector(data.selector);
          setLockedIndex(idx1);
          setHoverSelector("");
          const total =
            typeof data.total === "number" && data.total > 0
              ? data.total
              : null;
          setTotalMatches(total);
          setForm((f) => ({
            ...f,
            css_hint: data.selector,
            node_index: idx1,
          }));
          setPickerActive(false);
          pickingRef.current = false;
          try {
            iframe.contentWindow?.postMessage(
              { type: "PICKER_SET_ACTIVE", active: false },
              "*"
            );
          } catch {
            // ignore
          }
        }
      } else if (data.type === "PICKER_CANCELLED") {
        setPickerActive(false);
        pickingRef.current = false;
        setHoverSelector("");
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  useEffect(() => {
    if (fetchState.status !== "loaded") return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    const attachNav = () => {
      const doc = iframe.contentDocument;
      if (!doc) return;
      const handleNavClick = (e: MouseEvent) => {
        if (pickingRef.current) return;
        const path = (e.composedPath && e.composedPath()) || [];
        const a = path.find(
          (n) => n instanceof HTMLAnchorElement
        ) as HTMLAnchorElement | undefined;
        if (!a) return;
        const href = a.getAttribute("href");
        if (!href || href.startsWith("#")) return;
        if (
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey ||
          a.target === "_blank"
        )
          return;
        e.preventDefault();
        const abs = new URL(href, (fetchState as any).baseUrl).href;
        navigateIframe(abs);
      };
      doc.addEventListener("click", handleNavClick, true);
      (iframe as any).__cleanup_nav = () =>
        doc.removeEventListener("click", handleNavClick, true);
    };

    attachNav();
    const onLoad = () => attachNav();
    iframe.addEventListener("load", onLoad);
    return () => {
      try {
        (iframe as any).__cleanup_nav?.();
      } catch {
        // ignore
      }
      iframe.removeEventListener("load", onLoad);
    };
  }, [fetchState.status]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const flags = "allow-same-origin allow-scripts";
    if (iframe.sandbox) {
      iframe.sandbox.value = flags;
    }
  }, []);

  function resetPickerState() {
    setPickerActive(false);
    pickingRef.current = false;
    setHoverSelector("");
    setLockedSelector("");
    setLockedIndex(1);
    setTotalMatches(null);
    setForm((f) => ({ ...f, node_index: 1 }));
  }

  async function navigateIframe(absUrl: string) {
    setFetchState({ status: "loading" });
    resetPickerState();
    try {
      const res = await fetch(
        "/api/fetch?url=" + encodeURIComponent(absUrl),
        {
          method: "GET",
        }
      );
      if (!res.ok) throw new Error("Fetch failed (" + res.status + ")");
      const html = await res.text();
      setFetchState({
        status: "loaded",
        html,
        baseUrl: getOriginHref(absUrl),
      });
    } catch (e: any) {
      setFetchState({
        status: "error",
        message: e?.message || "Failed to navigate.",
      });
    }
  }

  async function loadForPicking() {
    if (!form.url) return;
    setFetchState({ status: "loading" });
    resetPickerState();
    try {
      const res = await fetch(
        "/api/fetch?url=" + encodeURIComponent(form.url),
        {
          method: "GET",
        }
      );
      if (!res.ok) throw new Error("Fetch failed (" + res.status + ")");
      const html = await res.text();
      setFetchState({
        status: "loaded",
        html,
        baseUrl: getOriginHref(form.url),
      });
    } catch (e: any) {
      setFetchState({
        status: "error",
        message: e?.message || "Failed to fetch page.",
      });
    }
  }

  function startPicking() {
    const w = iframeRef.current?.contentWindow;
    if (!w) return;
    pickingRef.current = true;
    setPickerActive(true);
    setHoverSelector("");
    try {
      w.postMessage({ type: "PICKER_SET_ACTIVE", active: true }, "*");
    } catch {
      // ignore
    }
    try {
      iframeRef.current?.contentDocument?.body?.focus({
        preventScroll: true,
      });
    } catch {
      // ignore
    }
  }

  function cancelPicking() {
    const w = iframeRef.current?.contentWindow;
    pickingRef.current = false;
    setPickerActive(false);
    setHoverSelector("");
    try {
      w?.postMessage({ type: "PICKER_SET_ACTIVE", active: false }, "*");
    } catch {
      // ignore
    }
  }

  function useSelector() {
    const selector = lockedSelector || hoverSelector;
    if (!selector) return;
    const idx = lockedIndex && lockedIndex > 0 ? lockedIndex : 1;
    setForm((f) => ({ ...f, css_hint: selector, node_index: idx }));
    cancelPicking();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/monitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          node_index: form.node_index ?? 1,
        }),
      });
      setLoading(false);
      if (res.ok) {
        setForm({
          url: "",
          name: "",
          css_hint: "",
          region: "us",
          email: "",
          node_index: 1,
        });
        window.location.reload();
      } else {
        const data = await res.json().catch(() => ({} as any));
        alert(data?.error || "Failed to create monitor");
      }
    } catch (err: any) {
      setLoading(false);
      alert(err?.message || "Failed to create monitor");
    }
  }

  function PreviewToolbar(props: { withHeightControls: boolean }) {
    const { withHeightControls } = props;
    const displaySelected = lockedSelector || "—";
    const displayHover = hoverSelector || "—";
    const indexLabel =
      lockedIndex && lockedIndex > 0
        ? "#" + lockedIndex
        : form.node_index
        ? "#" + form.node_index
        : "—";

    let matchInfo = "";
    if (totalMatches && totalMatches > 1 && lockedIndex && lockedIndex > 0) {
      matchInfo = `Match ${indexLabel} of ${totalMatches} for this selector`;
    } else if (totalMatches === 1) {
      matchInfo = "This selector matches 1 node";
    }

    return (
      <div className="flex items-center gap-2 bg-[rgba(17,24,39,.88)] text-white border border-white/10 rounded-xl p-2 shadow-xl">
        <div
          className={
            "w-2.5 h-2.5 rounded-full " +
            (pickerActive ? "bg-blue-400 animate-pulse" : "bg-gray-500")
          }
          title={pickerActive ? "Picking…" : "Idle"}
        />
        <button
          type="button"
          onClick={startPicking}
          className="px-3 py-1.5 rounded-lg border border-white/20 hover:bg-white/10"
          disabled={pickerActive}
        >
          Start
        </button>
        <button
          type="button"
          onClick={cancelPicking}
          className="px-3 py-1.5 rounded-lg border border-white/20 hover:bg-white/10"
          disabled={!pickerActive}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={useSelector}
          className="px-3 py-1.5 rounded-lg bg-blue-400 text-black font-semibold border border-blue-400"
          disabled={!lockedSelector && !hoverSelector}
        >
          Use selector
        </button>

        <div className="ml-2 flex flex-col text-[11px] leading-tight max-w-[360px]">
          <div title={lockedSelector || ""} className="truncate">
            <span className="font-semibold text-gray-100">Selected:</span>{" "}
            <span className="truncate">{displaySelected}</span>
          </div>
          <div title={hoverSelector || ""} className="truncate text-gray-300">
            <span>Hover:</span>{" "}
            <span className="truncate">{displayHover}</span>
          </div>
          <div className="text-xs text-gray-300">
            <span className="font-semibold">Node index:</span> {indexLabel}
          </div>
          {matchInfo && (
            <div className="text-[10px] text-amber-300 mt-0.5">
              {matchInfo}
            </div>
          )}
        </div>

        {withHeightControls && (
          <div className="ml-2 flex items-center gap-2">
            <button
              type="button"
              className="px-3 py-1.5 rounded border"
              onClick={() =>
                setPreviewHeight((h) => Math.min(h + 200, 1800))
              }
              title="Increase height"
            >
              Taller
            </button>
            <button
              type="button"
              className="px-3 py-1.5 rounded border"
              onClick={() =>
                setPreviewHeight((h) => Math.max(h - 200, 480))
              }
              title="Decrease height"
            >
              Shorter
            </button>
            <span className="text-gray-300 text-xs">
              H:{previewHeight}px
            </span>
          </div>
        )}

        {!isFullscreen ? (
          <button
            type="button"
            onClick={() => setIsFullscreen(true)}
            className="ml-2 px-3 py-1.5 rounded-lg border border-white/20 hover:bg-white/10"
            title="Enter fullscreen"
          >
            Fullscreen
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setIsFullscreen(false)}
            className="ml-2 px-3 py-1.5 rounded-lg border border-white/20 hover:bg-white/10"
            title="Exit fullscreen"
          >
            Exit
          </button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {/* Pricing URL + Load */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="block text-sm">Pricing page URL</label>
          <input
            className="w-full border rounded p-2"
            value={form.url}
            onChange={(e) =>
              setForm((f) => ({ ...f, url: e.target.value }))
            }
            placeholder="https://example.com/pricing"
          />
        </div>
        <button
          type="button"
          onClick={loadForPicking}
          className="px-4 py-2 rounded-lg border bg-white hover:bg-gray-50 sm:ml-2"
          disabled={!form.url}
          title={form.url ? "Load page into preview" : "Enter a URL first"}
        >
          Load
        </button>
      </div>

      {/* Visualization window */}
      <div className="relative border rounded-lg overflow-hidden bg-white">
        {fetchState.status === "idle" && (
          <div className="p-4 text-sm text-gray-500 min-h-[360px]">
            Load the page to pick a selector. Click a pricing card in the
            preview to capture its CSS selector and node index.
          </div>
        )}
        {fetchState.status === "loading" && (
          <div className="p-4 text-sm text-gray-500 min-h-[360px]">
            Loading…
          </div>
        )}
        {fetchState.status === "error" && (
          <div className="p-4 text-sm text-red-600 min-h-[360px]">
            Error: {fetchState.message}
          </div>
        )}
        {fetchState.status === "loaded" && !isFullscreen && (
          <div
            className="relative"
            style={{ height: previewHeight + "px" }}
          >
            <iframe
              ref={iframeRef}
              title="Live preview"
              className="w-full h-full"
              sandbox="allow-same-origin allow-scripts"
              srcDoc={srcdoc}
            />
            <div className="pointer-events-auto absolute right-3 bottom-3 z-50">
              <PreviewToolbar withHeightControls={true} />
            </div>
          </div>
        )}
      </div>

      {/* Fullscreen overlay */}
      {fetchState.status === "loaded" && isFullscreen && (
        <div className="fixed inset-0 z-1000 bg-black/80 p-4">
          <div className="h-full w-full bg-white rounded-lg overflow-hidden relative">
            <iframe
              ref={iframeRef}
              title="Live preview (fullscreen)"
              className="w-full h-full"
              sandbox="allow-same-origin allow-scripts"
              srcDoc={srcdoc}
            />
            <div className="pointer-events-auto absolute right-4 bottom-4">
              <PreviewToolbar withHeightControls={false} />
            </div>
          </div>
        </div>
      )}

      {/* Rest of the form */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm">Monitor name (optional)</label>
          <input
            className="w-full border rounded p-2"
            value={form.name}
            onChange={(e) =>
              setForm((f) => ({ ...f, name: e.target.value }))
            }
            placeholder="Acme Pricing"
          />
        </div>

        <div>
          <label className="block text-sm">CSS hint (selector)</label>
          <input
            className="w-full border rounded p-2"
            value={form.css_hint}
            onChange={(e) =>
              setForm((f) => ({ ...f, css_hint: e.target.value }))
            }
            placeholder=".pricing-grid, section#plans, div.hero-module__…__plan"
          />
          <p className="text-xs text-gray-500 mt-1">
            Tip: click an element in the preview, then press{" "}
            <b>Use selector</b> (or Enter in the preview) to fill this
            and its node index.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm">Region</label>
            <select
              className="w-full border rounded p-2"
              value={form.region}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  region: e.target.value as "us" | "eu",
                }))
              }
            >
              <option value="us">US</option>
              <option value="eu">EU</option>
            </select>
          </div>
          <div>
            <label className="block text-sm">Alert email</label>
            <input
              className="w-full border rounded p-2"
              value={form.email}
              onChange={(e) =>
                setForm((f) => ({ ...f, email: e.target.value }))
              }
              placeholder="you@company.com"
            />
          </div>
        </div>

        <div className="pt-1">
          <button
            disabled={loading}
            className="px-4 py-2 rounded-xl bg-black text-white"
          >
            {loading ? "Adding…" : "Add Monitor"}
          </button>
        </div>
      </div>
    </form>
  );
}
