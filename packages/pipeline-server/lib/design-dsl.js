'use strict';
// 对应 analyze-workflow Step 4① / generate-workflow Step D①：
// node-dsl schema-final JSON → design-dsl JSON（转换规则见 design-workflow-skill/docs/spec/design-dsl.md）
// 转换逻辑移植自 design-workflow-skill/scripts/schema-to-design-dsl.js，封装为可复用函数。

// ── 颜色转换 ──────────────────────────────────────────────────────────────────

function cssColorToHex(css) {
  if (!css) return null;
  css = css.trim();
  if (css === 'transparent' || css === 'rgba(0, 0, 0, 0)') return null;
  let m = css.match(/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/);
  if (m) return '#' + [m[1], m[2], m[3]].map(n => parseInt(n, 10).toString(16).padStart(2, '0')).join('').toUpperCase() + 'FF';
  m = css.match(/^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/);
  if (m) {
    const a = Math.round(parseFloat(m[4]) * 255);
    return '#' + [m[1], m[2], m[3]].map(n => parseInt(n, 10).toString(16).padStart(2, '0')).join('').toUpperCase()
      + a.toString(16).padStart(2, '0').toUpperCase();
  }
  m = css.match(/^#([0-9a-fA-F]{6})$/);
  if (m) return '#' + m[1].toUpperCase() + 'FF';
  m = css.match(/^#([0-9a-fA-F]{8})$/);
  if (m) return '#' + m[1].toUpperCase();
  return null;
}

function nidToId(nid) { return `1:${nid}`; }

// ── fills ─────────────────────────────────────────────────────────────────────

function parseGradientStops(str) {
  const stops = [];
  const re = /(#[0-9a-fA-F]{6,8}|rgba?\([^)]+\))\s+([\d.]+)%/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    const color = cssColorToHex(m[1]);
    if (color) stops.push({ position: parseFloat(m[2]) / 100, color });
  }
  return stops;
}

function buildFills(style) {
  const fills = [];
  const bgColor = cssColorToHex(style.backgroundColor);
  if (bgColor) fills.push({ type: 'solid', visible: true, opacity: 1, color: bgColor });
  const bgImg = style.backgroundImage;
  if (bgImg && bgImg !== 'none') {
    if (bgImg.startsWith('url(')) {
      const m = bgImg.match(/url\(["']?([^"')]+)["']?\)/);
      if (m) fills.push({ type: 'image', visible: true, opacity: 1, image_hash: m[1].split('/').pop().replace(/\.[^.]+$/, '') });
    } else if (bgImg.includes('gradient')) {
      fills.push({ type: 'gradient_linear', visible: true, opacity: 1, stops: parseGradientStops(bgImg) });
    }
  }
  return fills;
}

// ── strokes ───────────────────────────────────────────────────────────────────

function buildStrokes(style) {
  const strokes = [];
  const b = style.border;
  if (b && !b.startsWith('0px')) {
    const m = b.match(/^([\d.]+)px\s+\S+\s+(.+)$/);
    if (m) {
      const color = cssColorToHex(m[2].trim());
      if (color) strokes.push({ type: 'solid', visible: true, opacity: 1, color });
    }
  }
  return strokes;
}

// ── effects ───────────────────────────────────────────────────────────────────

function buildEffects(style) {
  const effects = [];
  const shadow = style.boxShadow;
  if (shadow && shadow !== 'none') {
    const m = shadow.match(/^([-\d.]+)px\s+([-\d.]+)px\s+([\d.]+)px(?:\s+([\d.]+)px)?\s+(.+)$/);
    if (m) {
      const color = cssColorToHex(m[5].trim());
      effects.push({
        type: 'drop_shadow', visible: true,
        offset_x: parseFloat(m[1]), offset_y: parseFloat(m[2]),
        blur: parseFloat(m[3]), spread: parseFloat(m[4] || '0'),
        ...(color ? { color } : {}),
      });
    }
  }
  return effects;
}

// ── corner_radius ─────────────────────────────────────────────────────────────

function buildCornerRadius(style) {
  const r = style.borderRadius;
  if (!r || r === '0px') return {};
  const parts = r.trim().split(/\s+/);
  if (parts.length === 1) return { corner_radius: parseFloat(parts[0]) };
  if (parts.length === 4) return { corner_radii: parts.map(parseFloat) };
  return { corner_radius: parseFloat(parts[0]) };
}

// ── text_style ────────────────────────────────────────────────────────────────

function fontWeightToStyle(w) {
  const n = parseInt(w, 10) || 400;
  if (n >= 700) return 'Bold';
  if (n >= 600) return 'SemiBold';
  if (n >= 500) return 'Medium';
  return 'Regular';
}

function buildTextStyle(style) {
  const ts = { font_family: 'HarmonyOS Sans' };
  ts.font_style     = fontWeightToStyle(style.fontWeight);
  ts.font_size      = style.fontSize ? parseFloat(style.fontSize) : 14;
  const color       = cssColorToHex(style.color);
  if (color) ts.color = color;
  ts.letter_spacing = style.letterSpacing ? parseFloat(style.letterSpacing) : 0;
  const lh          = style.lineHeight;
  ts.line_height    = (lh && lh !== 'normal') ? (parseFloat(lh) || 'auto') : 'auto';
  const align       = style.textAlign;
  ts.align_h        = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';
  ts.align_v        = 'center';
  return ts;
}

// ── auto_layout from CSS flex ─────────────────────────────────────────────────

function buildAutoLayout(style) {
  if (style.display !== 'flex') return null;
  const mapAlign = v => {
    if (v === 'center') return 'center';
    if (v === 'flex-end') return 'max';
    if (v === 'stretch') return 'stretch';
    return 'min';
  };
  const mapJustify = v => {
    if (v === 'center') return 'center';
    if (v === 'flex-end') return 'max';
    if (/space/.test(v || '')) return 'space_evenly';
    return 'min';
  };
  return {
    direction:       style.flexDirection === 'column' ? 'vertical' : 'horizontal',
    gap:             style.gap ? parseFloat(style.gap) : 0,
    counter_gap:     0,
    padding:         [0, 0, 0, 0],
    align_items:     mapAlign(style.alignItems || ''),
    justify_content: mapJustify(style.justifyContent || ''),
    wrap:            style.flexWrap === 'wrap',
  };
}

// ── 节点转换（递归） ──────────────────────────────────────────────────────────

const COMPONENT_SEMANTICS = new Set(['button', 'input', 'navbar', 'tabbar', 'switch', 'badge', 'avatar']);
const TEXT_SEMANTICS      = new Set(['text', 'heading']);

function convertNode(node, parentRect) {
  const style = node.style || {};
  const r  = node.rect || { x: 0, y: 0, w: 0, h: 0 };
  const pr = parentRect;
  const opacityRaw = parseFloat(style.opacity);
  const opacity = !isNaN(opacityRaw) ? opacityRaw : 1;

  const base = {
    id:         nidToId(node.nid),
    name:       node.label || `${node.tag || 'node'}-${node.nid}`,
    visible:    true,
    opacity,
    blend_mode: 'normal',
    box: { x: r.x - pr.x, y: r.y - pr.y, width: r.w, height: r.h },
  };

  // instance：有 component 字段的可匹配语义节点
  // componentKey / variant.variantKey 是组件库内的全局哈希，variant.guid 才是 SYMBOL GUID（symbol_id）
  // path 由 component-service 拼好返回，原样写入即可
  if (node.component && COMPONENT_SEMANTICS.has(node.semantic)) {
    const comp = node.component;
    return {
      ...base,
      type: 'instance',
      instance: {
        symbol_id:              comp.variant?.guid       || '',
        variant_key:            comp.variant?.variantKey || '',
        component_set_key:      comp.componentKey        || '',
        component_set_resolved: false,
        path:                   comp.path                || '',
      },
    };
  }

  // icon → frame with placeholder
  if (node.semantic === 'icon') {
    const layer = { ...base, type: 'frame' };
    layer.placeholder = {
      is_placeholder:   true,
      replacement_type: 'svg',
      ...(node.iconSvg ? { note: node.iconSvg } : {}),
    };
    return layer;
  }

  // text / heading（有文字内容且无子节点）
  const hasText = node.text && node.text.trim();
  const hasKids = (node.children || []).length > 0;
  if (TEXT_SEMANTICS.has(node.semantic) && hasText && !hasKids) {
    return {
      ...base,
      type:         'text',
      text_content: node.text.trim(),
      text_style:   buildTextStyle(style),
    };
  }

  // frame（默认）
  const layer = { ...base, type: 'frame' };
  const fills   = buildFills(style);
  const strokes = buildStrokes(style);
  const effects = buildEffects(style);
  const corners = buildCornerRadius(style);
  if (fills.length)                  layer.fills         = fills;
  if (strokes.length)                layer.strokes       = strokes;
  if (effects.length)                layer.effects       = effects;
  if (corners.corner_radius != null) layer.corner_radius = corners.corner_radius;
  if (corners.corner_radii)          layer.corner_radii  = corners.corner_radii;

  const autoLayout = buildAutoLayout(style);
  if (autoLayout) layer.auto_layout = autoLayout;

  const kids = (node.children || []).filter(c => {
    const cr = c.rect;
    return cr && (cr.w > 0 || cr.h > 0 || (c.children || []).length > 0);
  });
  if (kids.length) layer.children = kids.map(c => convertNode(c, r));

  return layer;
}

// ── 顶层包装 ──────────────────────────────────────────────────────────────────

/**
 * @param {object|object[]} schema  node-dsl 节点树（或节点数组）
 * @param {string} pageName         页面名称
 * @returns {object}                design-dsl JSON
 */
function buildDesignDsl(schema, pageName) {
  const now  = new Date().toISOString();
  const slug = pageName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const roots = Array.isArray(schema) ? schema : [schema];
  return {
    meta: {
      version:    '1.0.0',
      source:     'node-dsl',
      file_id:    slug,
      file_name:  pageName,
      created_at: now,
      updated_at: now,
    },
    pages: [{
      id:     '0:1',
      name:   pageName,
      layers: roots.map(r => convertNode(r, { x: 0, y: 0 })),
    }],
  };
}

/** 统计图层数量，便于打印概要 */
function countLayers(layers, acc = { total: 0, frames: 0, texts: 0, instances: 0, placeholders: 0 }) {
  for (const l of (layers || [])) {
    acc.total++;
    if      (l.type === 'instance') acc.instances++;
    else if (l.type === 'text')     acc.texts++;
    else if (l.type === 'frame')  { acc.frames++; if (l.placeholder) acc.placeholders++; }
    countLayers(l.children, acc);
  }
  return acc;
}

module.exports = { buildDesignDsl, countLayers };
