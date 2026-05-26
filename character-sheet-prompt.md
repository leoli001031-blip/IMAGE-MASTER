# 模特 Character Sheet — 模块化提示词模板

## 架构

```
第1层：固定版式层（layout + grid + background）
第2层：用户身份层（region, age, temperament, beauty, hair, makeup）
第3层：面部锚点层（face shape, eyes, brows, nose, lips, skin）
第4层：市场上下文层（market context → 决定体型和服装默认值）
第5层：体型层（height, frame, bust, waist, hip — 由 market 默认，用户可覆盖）
第6层：服装层（由 market 默认，用户可覆盖）
第7层：安全约束层（non-sexual, high coverage, professional）
第8层：画质 + 负向约束层
```

## 默认逻辑

| 用户输入 | 系统行为 |
|----------|----------|
| 只说身份 | → 白T牛仔裤基准服装 + 对应市场默认体型 |
| 说场景 | → 场景覆盖服装和体型 |
| 说服装 | → 覆盖默认服装 |
| 说身材 | → 覆盖 market 默认体型 |

## 体型预设

| 预设 | 描述 |
|------|------|
| `slim` | 168cm, slim straight frame, modest bust, narrow waist, subtle hip |
| `standard` | 172cm, slim-to-average, average bust, balanced waist-hip |
| `athletic` | 172cm, athletic medium, average-to-fuller bust, toned shoulders |

## 默认服装

> Neutral studio fitting casual outfit: clean fitted plain off-white crew-neck T-shirt, medium muted-blue high-waisted slim straight-leg jeans, clean white low-profile sneakers, minimal small stud earrings. No logo, no print, no ripped denim, no oversized fit, no fashion styling.

---

## 示例输出（East Asian female, 25, intellectual, slim）

```
Professional model character reference sheet, 3:2 landscape aspect ratio, pure white seamless studio background, clean editorial grid layout, spacious and minimal high-end commercial presentation.

The same exact adult professional model appears in every panel of this sheet, with identical facial features, same hairstyle, same body proportions, same age, same wardrobe, and consistent temperament across all panels.

Layout: Main section: full-body turn-around views, front, 3/4, side, back, neutral standing pose, full body visible, soft studio lighting, aligned to the same height. Left sidebar: simple model identity panel only, no height ruler, no measurement scale, no dense text. Top right: small color palette swatches matching the outfit. Right section: multi-angle head detail shots, front, 3/4 left, 3/4 right, side left, side right. Below the full-body views: expression row with neutral, happy, surprised, thoughtful, confident, gentle smile, serious, and warm laugh. Lower right: one large close-up portrait.

Model identity: 25-year-old adult East Asian female professional model, bright, clean, approachable, natural refined beauty, long straight dark hair, natural no-makeup look, flawless clean skin.

Distinct facial identity: soft oval face almond-shaped dark brown eyes with natural double eyelid, soft natural arched brows refined straight nose with natural bridge natural lips with subtle definition natural refined cheekbones and jawline, clear even skin tone, calm intelligent expression.

Market context: Mainland China everyday e-commerce.

Body profile: 168 cm, slim straight frame, modest bust silhouette, narrow waist, subtle hip curve, balanced natural proportions, not exaggerated, not glamour styling.

Wardrobe: Neutral studio fitting casual outfit: clean fitted plain off-white crew-neck T-shirt, medium muted-blue high-waisted slim straight-leg jeans, clean white low-profile sneakers, minimal small stud earrings. No logo, no print, no ripped denim, no oversized fit, no fashion styling.

Safety and tone: Functional commercial model reference, non-sexual, neutral standing pose, professional presentation, opaque fabric, high coverage, no seductive pose, no lingerie styling, no sheer fabric, no cleavage emphasis, no provocative expression.

Reference image instruction: Use the reference image only for layout structure, studio lighting, editorial cleanliness, and commercial character-sheet presentation. Do not copy the exact face, identity, ethnicity, hairstyle, body proportions, or wardrobe from the reference image.

Quality: Clean refined commercial rendering, soft even studio lighting, gentle contrast, minimal visual noise. Clean smooth softly retouched skin, even complexion, minimal visible skin texture.

Negative constraints: No height ruler, no measurement scale, no dense text, no watermark, no duplicate limbs, no distorted faces, no artifacts, no harsh shadows, no over-sharpening, no exaggerated curves.
```

## 生成参数

- Model: `gpt-image-2`
- Size: `1024x1024`
