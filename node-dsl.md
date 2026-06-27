# 语义节点 Schema

将剪枝后的节点树（nodes）、精简样式映射（styles）与 LLM 语义标注三者合并为单一 JSON 文件，每个节点内联自身样式，无需跨文件关联。

---

## 顶层结构

```
Node | Node[]
```

顶层为单个节点对象（单根页面）或节点数组（html/body 被剥掉后出现多个顶层子节点）。

---

## Node

| 字段 | 类型 | 必选 | 说明 |
|---|---|---|---|
| `nid` | number | 是 | 节点全局自增 ID，与 step1 styles 文件通过此字段关联 |
| `tag` | string | 是 | HTML 标签名，小写，如 `div` / `button` / `img` |
| `rect` | Rect | 是 | 节点绝对坐标和尺寸，见 [Rect](#rect) |
| `layerType` | string | 是 | **LLM 标注**。图层类型，见 [LayerType](#layertype) |
| `layerName` | string | 是 | **LLM 标注**。节点语义的简短名称，是 `layerDescription` 的简化版本，如 `"返回按钮"` / `"用户头像"` |
| `layerDescription` | string | 是 | **LLM 标注**。节点的详细业务描述，说明该节点具体做了什么事情。结合节点 `text`、`class`、`attrs`、父节点及页面整体上下文综合判断，描述到具体业务含义。同类节点在同一页面内必须可区分，如 `"点击后跳转登录页的按钮"` / `"点击后跳转注册页的按钮"`，不得笼统写 `"按钮"`。**`layerType` 为 `icon` 时还须注明尺寸和线条粗细，如 `"返回图标 24×24 细线"`** |
| `layerConfidence` | string | 否 | **LLM 标注**。标注置信度低时输出 `"low"`，默认（省略）即为 high |
| `style` | Style | 是 | 内联精简样式，见 [Style](#style)；样式全为默认值时为 `{}` |
| `id` | string | 否 | 元素 `id` 属性 |
| `class` | string | 否 | 元素 `class` 属性，截断至 200 字符 |
| `attrs` | object | 否 | 除 id/class/style 外的所有 HTML 属性键值对 |
| `text` | string | 否 | 直接子文本节点内容，截断至 300 字符 |
| `src` | string | 否 | img / video / audio / script 的 src |
| `alt` | string | 否 | img 的 alt |
| `href` | string | 否 | a / link 的 href |
| `type` | string | 否 | input 的 type |
| `naturalWidth` | number | 否 | img 原始宽度（px）|
| `naturalHeight` | number | 否 | img 原始高度（px）|
| `loaded` | boolean | 否 | img 是否加载成功 |
| `children` | Node[] | 否 | 子节点列表（有子节点时输出）|

---

## Rect

| 字段 | 类型 | 必选 | 说明 |
|---|---|---|---|
| `x` | number | 是 | 页面坐标系 X（`getBoundingClientRect().left`，已四舍五入）|
| `y` | number | 是 | 页面坐标系 Y（`top + scrollY`；`position:fixed` 元素不加 scrollY）|
| `w` | number | 是 | 宽度（px）|
| `h` | number | 是 | 高度（px）|
| `fixed` | boolean | 否 | 仅 `position:fixed` 元素出现，值固定为 `true` |

---

## Style

精简样式对象，只含非浏览器默认值的字段。所有字段均为可选。

**文字**

| 字段 | 类型 | 过滤条件（符合时才输出）|
|---|---|---|
| `fontFamily` | string | 始终输出，如 `"PingFang SC"` |
| `fontSize` | string | 始终输出，如 `"16px"` |
| `fontWeight` | string | 非 `"400"` |
| `color` | string | 非 `"rgb(0, 0, 0)"` |
| `lineHeight` | string | 非 `"normal"` |
| `letterSpacing` | string | 非 `"normal"` 且非 `"0px"` |
| `textAlign` | string | 非 `"start"` 且非 `"left"` |
| `textTransform` | string | 非 `"none"` |
| `whiteSpace` | string | 非 `"normal"` |

**布局**

| 字段 | 类型 | 过滤条件 |
|---|---|---|
| `display` | string | 非 `"block"` 且非 `"inline"`，如 `"flex"` / `"grid"` |
| `position` | string | 非 `"static"`，如 `"absolute"` / `"fixed"` |
| `flexDirection` | string | 非 `"row"`，如 `"column"` |
| `flexWrap` | string | 非 `"nowrap"` |
| `justifyContent` | string | 非 `"normal"` 且非 `"flex-start"` |
| `alignItems` | string | 非 `"normal"` 且非 `"stretch"` |
| `gap` | string | 非 `"normal"` 且非 `"0px"` |
| `gridTemplateColumns` | string | 非 `"none"` |

**弹性子项**（flex 容器的直接子节点才有意义，描述该子节点自身在父 flex 中的伸缩与对齐）

| 字段 | 类型 | 过滤条件 |
|---|---|---|
| `flexGrow` | string | 非 `"0"`，如 `"1"`（主轴方向按比例占据剩余空间）|
| `flexShrink` | string | 非 `"1"`，如 `"0"`（禁止收缩）|
| `flexBasis` | string | 非 `"auto"`，如 `"0%"` / `"120px"`（主轴初始尺寸）|
| `alignSelf` | string | 非 `"auto"`，如 `"stretch"` / `"center"` / `"flex-end"`（覆盖父级 `alignItems`）|

**定位**

| 字段 | 类型 | 过滤条件 |
|---|---|---|
| `top` / `left` / `right` / `bottom` | string | 非 `"auto"` |
| `zIndex` | string | 非 `"auto"` |

**背景**

| 字段 | 类型 | 过滤条件 |
|---|---|---|
| `backgroundColor` | string | 非透明（非 `"rgba(0, 0, 0, 0)"` 且非 `"transparent"`）|
| `backgroundImage` | string | 非 `"none"`（CSS 渐变或 `url(...)`）|
| `backgroundSize` | string | 有 `backgroundImage` 时才出现 |
| `backgroundPosition` | string | 有 `backgroundImage` 时才出现 |
| `backgroundRepeat` | string | 非 `"repeat"` 且有 `backgroundImage` |

**装饰**

| 字段 | 类型 | 过滤条件 |
|---|---|---|
| `borderRadius` | string | 非 `"0px"` |
| `border` | string | 不以 `"0px"` 开头 |
| `boxShadow` | string | 非 `"none"` |
| `opacity` | string | 非 `"1"` |
| `overflow` | string | 非 `"visible"` |
| `transform` | string | 非 `"none"` |

**遮罩**

| 字段 | 类型 | 过滤条件 |
|---|---|---|
| `maskImage` | string | 非 `"none"` |
| `maskSize` / `maskPosition` | string | 有 `maskImage` 时才出现 |
| `backdropFilter` | string | 非 `"none"` |

**图片内容**

| 字段 | 类型 | 出现条件 |
|---|---|---|
| `imageData` | string | `img` 标签（非 SVG）且已成功加载时，内容编码为 base64 Data URL，格式 `data:image/png;base64,...` |
| `svgContent` | string | `img[src=*.svg]` 或 `data:image/svg+xml` 加载成功时，值为原始 SVG XML 字符串；内联 `<svg>` 标签时，值为该元素的 `outerHTML` |

> 两个字段均由 Step 1 的 `extractNodes()` 写入 styles 映射，经 `prune-nodes.js` 透传至 Step 2 的 `styles-<filename>.json`，最终内联到 schema 的每个节点的 `style` 字段中。  
> 跨域图片受 canvas 污染限制，`imageData` 可能为空；SVG 跨域时同步 XHR 会失败，`svgContent` 亦可能为空。

---

## LayerType
| 值 | 可有子节点 | 含义 |
|---|---|---|
| `frame` | ✅ 是 | 布局容器图层（div / section / article 等承担布局职责的节点）|
| `image` | ✅ 是 | 图片图层（img 标签或背景图）|
| `text` | ❌ 否 | 纯文字图层，叶子节点 |
| `icon` | ❌ 否 | 图标图层（SVG / 字体图标 / 小尺寸 img），叶子节点 |
| `component` | ❌ 否 | 组件图层（对应设计系统中可复用的组件，如按钮、输入框、开关等），叶子节点 |
| `rectangle` | ❌ 否  | 普通矩形图层（无特定语义的矩形色块，如分割线、背景块等）|

> ⛔ `text` / `icon` / `component` / `rectangle` 节点**不得有 `children` 字段**，其内部结构由组件系统管理，不在 node-dsl 中展开。

---

## 完整示例

```json
{
  "nid": 3,
  "tag": "div",
  "rect": { "x": 0, "y": 0, "w": 375, "h": 812 },
  "id": "app",
  "class": "page page--login",
  "layerType": "frame",
  "layerName": "登录页根容器",
  "layerDescription": "登录页面的根布局容器，纵向排列导航栏、表单和底部标签栏",
  "style": { "display": "flex", "flexDirection": "column", "backgroundColor": "rgb(245,245,245)" },
  "children": [

    {
      "nid": 4,
      "tag": "header",
      "rect": { "x": 0, "y": 0, "w": 375, "h": 56, "fixed": true },
      "class": "navbar",
      "layerType": "frame",
      "layerName": "顶部导航栏",
      "layerDescription": "固定在页面顶部的导航栏，包含返回图标和页面标题",
      "style": {
        "display": "flex",
        "alignItems": "center",
        "position": "fixed",
        "top": "0px",
        "zIndex": "100",
        "backgroundColor": "rgb(255,255,255)",
        "boxShadow": "0px 1px 0px rgba(0,0,0,0.08)"
      },
      "children": [
        {
          "nid": 5,
          "tag": "span",
          "rect": { "x": 16, "y": 16, "w": 24, "h": 24 },
          "class": "icon icon--back",
          "layerType": "icon",
          "layerName": "返回图标",
          "layerDescription": "点击后返回上一页的图标，24×24 细线",
          "style": { "fontSize": "24px" }
        },
        {
          "nid": 6,
          "tag": "h1",
          "rect": { "x": 130, "y": 12, "w": 115, "h": 32 },
          "text": "登录",
          "layerType": "text",
          "layerName": "页面标题",
          "layerDescription": "显示当前页面名称"登录"的标题文字",
          "style": { "fontFamily": "PingFang SC", "fontSize": "18px", "fontWeight": "600", "textAlign": "center" }
        }
      ]
    },

    {
      "nid": 10,
      "tag": "form",
      "rect": { "x": 20, "y": 80, "w": 335, "h": 360 },
      "class": "login-form",
      "layerType": "frame",
      "layerName": "登录表单",
      "layerDescription": "包含用户名输入框、密码输入框和登录按钮的表单区域",
      "style": {
        "display": "flex",
        "flexDirection": "column",
        "gap": "16px",
        "backgroundColor": "rgb(255,255,255)",
        "borderRadius": "16px",
        "boxShadow": "0px 8px 24px rgba(0,0,0,0.08)"
      },
      "children": [

        {
          "nid": 22,
          "tag": "img",
          "rect": { "x": 128, "y": 96, "w": 80, "h": 80 },
          "src": "/images/avatar-default.png",
          "alt": "默认头像",
          "naturalWidth": 80,
          "naturalHeight": 80,
          "loaded": true,
          "layerType": "image",
          "layerName": "用户头像",
          "layerDescription": "登录表单顶部展示的默认用户头像图片",
          "style": {
            "borderRadius": "50%",
            "imageData": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFAAAABQCAYAAACOEfKtAAAA..."
          }
        },

        {
          "nid": 11,
          "tag": "div",
          "rect": { "x": 20, "y": 80, "w": 335, "h": 56 },
          "class": "input-field",
          "layerType": "frame",
          "layerName": "用户名输入框容器",
          "layerDescription": "用户名输入框的外层容器，内含原生 input 组件",
          "style": {
            "display": "flex",
            "alignItems": "center",
            "border": "1px solid rgb(229,229,229)",
            "borderRadius": "8px",
            "backgroundColor": "rgb(250,250,250)"
          },
          "children": [
            {
              "nid": 12,
              "tag": "input",
              "rect": { "x": 36, "y": 96, "w": 303, "h": 24 },
              "attrs": { "placeholder": "请输入用户名" },
              "type": "text",
              "layerType": "component",
              "layerName": "用户名 input",
              "layerDescription": "用户名输入框的原生 input 元素，placeholder 提示「请输入用户名」",
              "style": { "fontFamily": "PingFang SC", "fontSize": "16px", "color": "rgb(26,26,26)", "flexGrow": "1" }
            }
          ]
        },

        {
          "nid": 20,
          "tag": "button",
          "rect": { "x": 20, "y": 260, "w": 335, "h": 48 },
          "class": "btn btn--primary",
          "text": "登录",
          "layerType": "component",
          "layerName": "主登录按钮",
          "layerDescription": "点击后提交表单并执行登录操作的主要操作按钮",
          "style": {
            "display": "flex",
            "justifyContent": "center",
            "alignItems": "center",
            "backgroundColor": "rgb(52,120,246)",
            "borderRadius": "8px",
            "fontSize": "16px",
            "fontWeight": "600",
            "color": "rgb(255,255,255)"
          }
        },

      ]
    },

    {
      "nid": 30,
      "tag": "nav",
      "rect": { "x": 0, "y": 746, "w": 375, "h": 66, "fixed": true },
      "class": "tabbar",
      "layerType": "frame",
      "layerName": "底部标签栏",
      "layerDescription": "固定在页面底部的导航标签栏，用于在多个主页面之间切换",
      "style": {
        "display": "flex",
        "justifyContent": "space-around",
        "alignItems": "center",
        "position": "fixed",
        "bottom": "0px",
        "zIndex": "100",
        "backgroundColor": "rgb(255,255,255)",
        "boxShadow": "0px -1px 0px rgba(0,0,0,0.06)"
      }
    }

  ]
}
```
