# 设计 DSL（Phase 1）

基于 Pixso 设计稿解析出的通用结构，JSON 格式，描述图层树和云端组件实例引用。

---

## 顶层结构

```json
{
  "meta": { ... },
  "pages": [ Page, ... ]
}
```

| 字段 | 类型 | 必选 | 说明 |
|---|---|---|---|
| `meta` | Meta | 是 | 文件元信息 |
| `pages` | Page[] | 是 | 页面列表 |

---

## Meta

| 字段 | 类型 | 必选 | 说明 |
|---|---|---|---|
| `version` | string | 是 | DSL 格式版本，格式 `Major.Minor.Patch`，如 `1.0.0` |
| `source` | string | 是 | 来源标识，固定值 `"pixso"` |
| `file_id` | string | 是 | 文件唯一标识 |
| `file_name` | string | 是 | 文件名称 |
| `created_at` | string | 是 | 创建时间，ISO 8601（`YYYY-MM-DDTHH:mm:ssZ`）|
| `updated_at` | string | 是 | 更新时间，ISO 8601 |

---

## Page

| 字段 | 类型 | 必选 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 页面 GUID，格式 `"sessionID:localID"` |
| `name` | string | 是 | 页面名称 |
| `layers` | Layer[] | 是 | 根图层列表（递归嵌套） |

---

## Layer（联合类型）

`Layer = NormalLayer | InstanceLayer`，由 `type` 字段区分。

### 公共字段

| 字段 | 类型 | 必选 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 节点 GUID，格式 `"sessionID:localID"` |
| `name` | string | 是 | 节点名称 |
| `type` | string | 是 | 节点类型，见 [LayerType](#layertype) |
| `visible` | boolean | 是 | 是否可见 |
| `opacity` | number | 是 | 透明度，范围 `0`~`1` |
| `blend_mode` | string | 是 | 混合模式，见 [BlendMode](#blendmode) |
| `box` | BoundingBox | 是 | 节点包围框，相对父节点坐标 |
| `placeholder` | PlaceholderMeta | 否 | 占位符元信息（标记临时替代图层）|

### NormalLayer（普通图层）

`type` 为 `frame / group / rectangle / ellipse / vector / star / line / boolean / text` 之一。

| 字段 | 类型 | 必选 | 说明 |
|---|---|---|---|
| `fills` | Fill[] | 否 | 填充列表 |
| `strokes` | Stroke[] | 否 | 描边列表（**未实现**）|
| `effects` | Effect[] | 否 | 效果列表（阴影、模糊等）（**未实现**）|
| `corner_radius` | number | 否 | 圆角半径（统一值）|
| `corner_radii` | number[4] | 否 | 四角独立圆角 `[TL, TR, BR, BL]`，与 `corner_radius` 互斥（**未实现**）|
| `auto_layout` | AutoLayout | 否 | 自动布局（仅 `frame` 类型，且开启了 Auto Layout）（**未实现**）|
| `text_content` | string | 否 | 文本内容（仅 `text` 类型）|
| `text_style` | TextStyle | 否 | 文本样式（仅 `text` 类型）|
| `children` | Layer[] | 否 | 子图层列表（仅 `frame / group / boolean` 类型）|

### InstanceLayer（实例图层）

`type` 固定为 `"instance"`。实例图层**不含 `children`**，内容由库在运行时提供。

| 字段 | 类型 | 必选 | 说明 |
|---|---|---|---|
| `instance` | CloudInstanceRef | 是 | 云端组件引用数据 |

---

## CloudInstanceRef

所有实例图层均视为云端组件实例。`variant_key` 或 `component_set_key` 为空时，解析器应直接报错。

| 字段 | 类型 | 必选 | 说明 |
|---|---|---|---|
| `symbol_id` | string | 是 | 变体 SYMBOL 的 GUID，格式 `"sessionID:localID"`。转换时与组件集 hex 中查到的 GUID 做校验，不一致则以库为准并更新 |
| `variant_key` | string | 是 | 变体的 `componentKey`（该 SYMBOL 的全局唯一 hash）|
| `component_set_key` | string | 是 | 所属组件集的 `componentKey`；若该组件无父组件集，则与 `variant_key` 相同 |
| `component_set_resolved` | boolean | 是 | 组件集是否可在已加载的库中被解析。`false` 表示 key 存在但库不可用（**未实现**）|
| `path` | string | 是 | 组件集 hex 文件相对组件库根目录（`HEX_LIB_DIR`）的路径，格式 `"{source}/{hexFile}"`，如 `"h-design-chart/component/93_55829.txt"`。来自 component-service 匹配结果中的 `path` 字段，原样写入即可。`dsl-to-hex` 转换时直接拼接 `HEX_LIB_DIR + path` 读取本地 hex 文件，不再请求 component-service |
| `variant_props` | object | 否 | 变体属性键值对，如 `{"状态": "Pressed", "尺寸": "Medium"}` |
| `overrides` | InstanceOverride[] | 否 | 实例级属性覆写列表 |

### InstanceOverride

| 字段 | 类型 | 必选 | 说明 |
|---|---|---|---|
| `node_id` | string | 是 | 被覆写的子节点 GUID |
| `field` | string | 是 | 覆写的字段名，如 `"text_content"` / `"visible"` / `"fills"` |
| `value` | any | 是 | 覆写的值，类型与 `field` 对应 |

---

## BoundingBox

| 字段 | 类型 | 说明 |
|---|---|---|
| `x` | number | 相对父节点的 X 偏移（来自 transform.m02）|
| `y` | number | 相对父节点的 Y 偏移（来自 transform.m12）|
| `width` | number | 宽度 |
| `height` | number | 高度 |

---

## AutoLayout

| 字段 | 类型 | 说明 |
|---|---|---|
| `direction` | string | `"horizontal"` / `"vertical"` |
| `gap` | number | 主轴间距 |
| `counter_gap` | number | 交叉轴间距（wrap 模式下）|
| `padding` | number[4] | 内边距 `[top, right, bottom, left]` |
| `align_items` | string | 交叉轴对齐：`"min"` / `"center"` / `"max"` / `"stretch"` |
| `justify_content` | string | 主轴对齐：`"min"` / `"center"` / `"max"` / `"space_evenly"` |
| `wrap` | boolean | 是否换行 |

---

## Fill / Stroke

| 字段 | 类型 | 说明 |
|---|---|---|
| `type` | string | `"solid"` / `"gradient_linear"` / `"gradient_radial"` / `"image"` |
| `visible` | boolean | 是否可见 |
| `opacity` | number | 填充透明度 |
| `color` | string | HEX 颜色（仅 `solid`），如 `"#FF5733FF"`（含 Alpha）|
| `stops` | ColorStop[] | 渐变色标（仅渐变类型）|
| `image_hash` | string | 图片 hash（仅 `image`）|

---

## TextStyle

| 字段 | 类型 | 说明 |
|---|---|---|
| `font_family` | string | 字体名称 |
| `font_style` | string | 字重/样式，如 `"Regular"` / `"Bold"` |
| `font_size` | number | 字号（px）|
| `color` | string | 文字颜色（HEX + Alpha）|
| `letter_spacing` | number | 字间距（**未实现**）|
| `line_height` | number \| string | 行高（px 或 `"auto"`）（**未实现**）|
| `align_h` | string | 水平对齐：`"left"` / `"center"` / `"right"` / `"justified"`（**未实现**）|
| `align_v` | string | 垂直对齐：`"top"` / `"center"` / `"bottom"`（**未实现**）|

---

## LayerType

| 值 | 说明 |
|---|---|
| `frame` | 容器帧（对应 Pixso FRAME）|
| `group` | 编组（对应 GROUP）|
| `rectangle` | 矩形 |
| `ellipse` | 椭圆 |
| `vector` | 矢量路径 |
| `star` | 星形 |
| `line` | 直线 |
| `boolean` | 布尔运算组合（BOOLEAN_OPERATION）|
| `text` | 文本 |
| `instance` | 云端组件实例（INSTANCE）|

---

## BlendMode

值参考 Pixso BlendMode 枚举，小写下划线格式，如：
`normal` / `multiply` / `screen` / `overlay` / `darken` / `lighten` / `color_dodge` / `color_burn` 等。

---

## 完整示例

```json
{
  "meta": {
    "version": "1.0.0",
    "source": "pixso",
    "file_id": "file-abc123",
    "file_name": "HarmonyOS 设计稿",
    "created_at": "2026-06-01T00:00:00Z",
    "updated_at": "2026-06-01T12:00:00Z"
  },
  "pages": [
    {
      "id": "0:1",
      "name": "页面 1",
      "layers": [
        {
          "id": "8:1",
          "name": "容器",
          "type": "frame",
          "visible": true,
          "opacity": 1,
          "blend_mode": "normal",
          "box": { "x": 0, "y": 0, "width": 375, "height": 200 },
          "fills": [{ "type": "solid", "visible": true, "opacity": 1, "color": "#FFFFFFFF" }],
          "auto_layout": {
            "direction": "horizontal",
            "gap": 12,
            "padding": [16, 16, 16, 16],
            "align_items": "center",
            "justify_content": "min",
            "wrap": false
          },
          "children": [
            {
              "id": "9:49",
              "name": "标题文本",
              "type": "text",
              "visible": true,
              "opacity": 1,
              "blend_mode": "normal",
              "box": { "x": 16, "y": 16, "width": 200, "height": 24 },
              "text_content": "用户名",
              "text_style": {
                "font_family": "HarmonyOS Sans",
                "font_style": "Bold",
                "font_size": 16,
                "color": "#1A1A1AFF",
                "letter_spacing": 0,
                "line_height": "auto",
                "align_h": "left",
                "align_v": "center"
              }
            },
            {
              "id": "10:28",
              "name": "图标按钮",
              "type": "instance",
              "visible": true,
              "opacity": 1,
              "blend_mode": "normal",
              "box": { "x": 228, "y": 16, "width": 40, "height": 40 },
              "instance": {
                "symbol_id": "10:30",
                "variant_key": "549fdf93a10fec402c93432a2e228e407ccc2954",
                "component_set_key": "ecb8481025909ec9371c3b25104bb8b7c1079224",
                "component_set_resolved": false,
                "path": "h-design-chart/component/93_55829.txt",
                "variant_props": { "尺寸": "40" },
                "overrides": []
              }
            }
          ]
        }
      ]
    }
  ]
}
```

---

## PlaceholderMeta

占位符标记数据，用于标记需要替换为 SVG 或图片资源的图层。仅 SVG 和图片类型的图层会使用占位符。placeholder 数据会写入 Pixso 文件的 pluginData 字段，便于后续处理。

| 字段 | 类型 | 必选 | 说明 |
|---|---|---|---|
| `is_placeholder` | boolean | 是 | 是否为占位符 |
| `replacement_type` | `"svg"` \| `"image"` | 是 | 替换类型：<br>• `"svg"` - 矢量 SVG 资源<br>• `"image"` - 图片资源 |
| `note` | string | 否 | SVG 或图片的详细数据（SVG 字符串 或 图片 base64）|

**pluginData 写入规则**：
- 当图层包含 `placeholder` 字段时，解析器会将其写入 PixsoNode 的 pluginData 数组
- pluginID：`"pluginID"`
- key：`"placeholder"`
- value：JSON 字符串格式，包含上述三个字段

**示例**：
```json
{
  "id": "1:14",
  "name": "眼睛图标",
  "type": "ellipse",
  "placeholder": {
    "is_placeholder": true,
    "replacement_type": "svg",
    "note": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 20 20\">...</svg>"
  },
  "box": { "x": 404, "y": 372, "width": 20, "height": 20 }
}
```
