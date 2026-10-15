import React, { useState, useRef, useCallback } from "react";

// Inline "i" info dot with a hover/focus tooltip bubble. Used for metric and
// column hints so an unclear number can be explained in place.
export function InfoTip({ text }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null); // {x,y,below} viewport px, null = hidden

  // Render the bubble with position:fixed computed from the dot's rect so it
  // escapes any overflow/scroll ancestor (e.g. .tablewrap overflow-x:auto clips
  // an absolutely-positioned tooltip down to a sliver). Flip below when there is
  // no room above, and clamp horizontally so it never runs off the viewport.
  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = r.top < 90;
    const half = 140; // ~bubble max-width / 2
    const x = Math.min(Math.max(r.left + r.width / 2, half + 8), window.innerWidth - half - 8);
    setPos({ x, y: below ? r.bottom : r.top, below });
  }, []);
  const hide = useCallback(() => setPos(null), []);

  if (!text) return null;
  return (
    <span
      ref={ref}
      className="infotip"
      tabIndex={0}
      role="button"
      aria-label={text}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onClick={(e) => {
        e.stopPropagation();
        if (pos) hide();
        else show();
      }}
    >
      i
      {pos && (
        <span
          className="infotip-bubble"
          role="tooltip"
          style={{
            top: pos.y,
            left: pos.x,
            transform: pos.below ? "translate(-50%, 8px)" : "translate(-50%, calc(-100% - 8px))",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

/**
 * PageHeader - the page title row + an "About this page" (? ) toggle.
 * Clicking ? expands a panel that lists, in plain language, what the page shows,
 * where each number comes from (Cloudflare-native vs custom-tracked), how the
 * filters apply, and any caveats - so every detail is checkable without leaving
 * the page. `items` is an array of short strings (rendered as bullets).
 */
export default function PageHeader({ title, sub, badge, items = [], children }) {
  const [open, setOpen] = useState(false);
  const hasInfo = items.length > 0 || !!children;
  return (
    <div className="pagehead">
      <h2 className="pagetitle">
        {title}
        {badge ? <span className="badge">{badge}</span> : null}
        {sub ? <span className="sub">{sub}</span> : null}
        {hasInfo && (
          <button
            type="button"
            className={"info-btn" + (open ? " on" : "")}
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            title="About this page - what these numbers mean"
          >
            ?
          </button>
        )}
      </h2>
      {open && hasInfo && (
        <div className="pageinfo">
          <h4>About this page</h4>
          {items.length > 0 && (
            <ul>
              {items.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
