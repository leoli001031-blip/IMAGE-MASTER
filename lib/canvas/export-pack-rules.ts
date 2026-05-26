export type ExportPackId =
  | "taobao"
  | "amazon"
  | "xiaohongshu"
  | "poster_set"
  | "model_display"
  | "detail_page";

export type ExportPackPlatform =
  | "taobao"
  | "amazon"
  | "xiaohongshu"
  | "multi_channel"
  | "commerce_site";

export interface ExportPackSpec {
  id: string;
  title: string;
  purpose: string;
  size: string;
  ratio: string;
  count: number;
  naming: string;
  whiteBackground: boolean;
  textAllowed: boolean;
  modelRequired: boolean;
  qualityRules: string[];
}

export interface ExportPackItem {
  id: string;
  title: string;
  role: string;
  count: number;
  requiredAssets: string[];
  outputType: "single_image" | "image_series" | "long_image" | "poster_series";
}

export interface ExportPackRule {
  id: ExportPackId;
  title: string;
  platform: ExportPackPlatform;
  useCase: string;
  description: string;
  items: ExportPackItem[];
  specs: ExportPackSpec[];
}

export const exportPackRules: ExportPackRule[] = [
  {
    id: "taobao",
    title: "淘宝详情页",
    platform: "taobao",
    useCase: "detail_page",
    description: "面向淘宝商品页的首图、卖点条、细节和场景长图组合。",
    items: [
      {
        id: "taobao-main-item",
        title: "商品主图",
        role: "搜索入口和商品首屏识别",
        count: 1,
        requiredAssets: ["product"],
        outputType: "single_image",
      },
      {
        id: "taobao-detail-item",
        title: "详情页长图组",
        role: "卖点、材质、细节和场景承接",
        count: 5,
        requiredAssets: ["product", "style"],
        outputType: "long_image",
      },
    ],
    specs: [
      {
        id: "taobao-main",
        title: "主图",
        purpose: "搜索和商品卡首屏",
        size: "800x800",
        ratio: "1:1",
        count: 1,
        naming: "taobao_main_01",
        whiteBackground: true,
        textAllowed: false,
        modelRequired: false,
        qualityRules: ["主体居中", "边缘完整", "无夸张文字"],
      },
      {
        id: "taobao-detail",
        title: "详情长图",
        purpose: "承接首屏卖点和材质细节",
        size: "750x1200",
        ratio: "5:8",
        count: 5,
        naming: "taobao_detail_01-05",
        whiteBackground: false,
        textAllowed: true,
        modelRequired: false,
        qualityRules: ["中文文案可读", "细节不变形", "卖点顺序清晰"],
      },
    ],
  },
  {
    id: "amazon",
    title: "亚马逊主图",
    platform: "amazon",
    useCase: "main_image_pack",
    description: "覆盖亚马逊主图、辅图和生活方式图的合规输出包。",
    items: [
      {
        id: "amazon-main-item",
        title: "白底主图",
        role: "Listing 首图合规展示",
        count: 1,
        requiredAssets: ["product"],
        outputType: "single_image",
      },
      {
        id: "amazon-gallery-item",
        title: "辅图和生活方式图",
        role: "解释尺寸、材质、使用场景和差异点",
        count: 6,
        requiredAssets: ["product", "scene"],
        outputType: "image_series",
      },
    ],
    specs: [
      {
        id: "amazon-main",
        title: "主图白底",
        purpose: "Listing 首图",
        size: "2000x2000",
        ratio: "1:1",
        count: 1,
        naming: "amazon_main_01",
        whiteBackground: true,
        textAllowed: false,
        modelRequired: false,
        qualityRules: ["纯白背景", "商品占画面 85%", "无水印文字"],
      },
      {
        id: "amazon-lifestyle",
        title: "辅图",
        purpose: "材质、尺寸和生活方式展示",
        size: "2000x2000",
        ratio: "1:1",
        count: 6,
        naming: "amazon_gallery_01-06",
        whiteBackground: false,
        textAllowed: true,
        modelRequired: false,
        qualityRules: ["信息层级清楚", "无违规承诺", "商品结构一致"],
      },
    ],
  },
  {
    id: "xiaohongshu",
    title: "小红书图文",
    platform: "xiaohongshu",
    useCase: "social_post",
    description: "适合笔记封面、种草组图和自然场景试穿的图文包。",
    items: [
      {
        id: "xhs-cover-item",
        title: "笔记封面",
        role: "信息流点击入口",
        count: 1,
        requiredAssets: ["product", "style", "model"],
        outputType: "single_image",
      },
      {
        id: "xhs-gallery-item",
        title: "种草组图",
        role: "用统一视觉语言讲清使用体验",
        count: 5,
        requiredAssets: ["product", "style", "scene"],
        outputType: "image_series",
      },
    ],
    specs: [
      {
        id: "xhs-cover",
        title: "笔记封面",
        purpose: "信息流点击入口",
        size: "1242x1660",
        ratio: "3:4",
        count: 1,
        naming: "xhs_cover_01",
        whiteBackground: false,
        textAllowed: true,
        modelRequired: true,
        qualityRules: ["封面文字少而清楚", "人物不遮挡商品", "真实生活感"],
      },
      {
        id: "xhs-gallery",
        title: "种草组图",
        purpose: "穿搭、细节和场景补充",
        size: "1242x1660",
        ratio: "3:4",
        count: 5,
        naming: "xhs_gallery_01-05",
        whiteBackground: false,
        textAllowed: true,
        modelRequired: true,
        qualityRules: ["色调统一", "商品颜色稳定", "姿态自然"],
      },
    ],
  },
  {
    id: "poster_set",
    title: "海报组图",
    platform: "multi_channel",
    useCase: "campaign_poster",
    description: "用于活动页、私域和投放素材的主视觉与延展海报。",
    items: [
      {
        id: "poster-key-visual-item",
        title: "活动主视觉",
        role: "确定主题、商品、文案和品牌调性",
        count: 2,
        requiredAssets: ["product", "style"],
        outputType: "poster_series",
      },
      {
        id: "poster-adaptation-item",
        title: "渠道延展图",
        role: "把主视觉扩展成社媒和店铺模块",
        count: 3,
        requiredAssets: ["product", "style"],
        outputType: "poster_series",
      },
    ],
    specs: [
      {
        id: "poster-vertical",
        title: "竖版主海报",
        purpose: "活动主视觉",
        size: "1080x1920",
        ratio: "9:16",
        count: 2,
        naming: "poster_vertical_01-02",
        whiteBackground: false,
        textAllowed: true,
        modelRequired: false,
        qualityRules: ["标题安全区充足", "主体不被遮挡", "品牌色稳定"],
      },
      {
        id: "poster-square",
        title: "方版延展",
        purpose: "社媒和店铺模块",
        size: "1080x1080",
        ratio: "1:1",
        count: 3,
        naming: "poster_square_01-03",
        whiteBackground: false,
        textAllowed: true,
        modelRequired: false,
        qualityRules: ["构图可裁切", "文案不贴边", "系列风格一致"],
      },
    ],
  },
  {
    id: "model_display",
    title: "模特展示图",
    platform: "commerce_site",
    useCase: "model_display",
    description: "面向服饰上身、姿态变化和场景展示的模特图包。",
    items: [
      {
        id: "model-half-item",
        title: "半身上身图",
        role: "展示版型、领口、袖口和材质质感",
        count: 4,
        requiredAssets: ["product", "model", "style"],
        outputType: "image_series",
      },
      {
        id: "model-full-item",
        title: "全身搭配图",
        role: "表达整体搭配和商业大片感",
        count: 2,
        requiredAssets: ["product", "model", "scene"],
        outputType: "image_series",
      },
    ],
    specs: [
      {
        id: "model-half",
        title: "半身展示",
        purpose: "商品上身效果",
        size: "1200x1600",
        ratio: "3:4",
        count: 4,
        naming: "model_half_01-04",
        whiteBackground: false,
        textAllowed: false,
        modelRequired: true,
        qualityRules: ["版型比例一致", "手部不遮挡重点", "肤色和光线自然"],
      },
      {
        id: "model-full",
        title: "全身搭配",
        purpose: "整体风格和穿搭建议",
        size: "1200x1600",
        ratio: "3:4",
        count: 2,
        naming: "model_full_01-02",
        whiteBackground: false,
        textAllowed: false,
        modelRequired: true,
        qualityRules: ["鞋包配饰不抢主体", "下摆和袖口清楚", "背景不过度复杂"],
      },
    ],
  },
  {
    id: "detail_page",
    title: "详情页模块",
    platform: "commerce_site",
    useCase: "detail_page_modules",
    description: "拆成首屏、卖点、细节、对比和尺码提示的页面模块包。",
    items: [
      {
        id: "detail-hero-item",
        title: "详情首屏",
        role: "把产品定位和第一转化点讲清楚",
        count: 1,
        requiredAssets: ["product", "style"],
        outputType: "single_image",
      },
      {
        id: "detail-module-item",
        title: "详情模块组",
        role: "按卖点、材质、工艺、尺码和场景拆分页面",
        count: 6,
        requiredAssets: ["product", "style", "scene"],
        outputType: "long_image",
      },
    ],
    specs: [
      {
        id: "detail-hero",
        title: "详情首屏",
        purpose: "进入页面后的第一屏转化",
        size: "750x1000",
        ratio: "3:4",
        count: 1,
        naming: "detail_hero_01",
        whiteBackground: false,
        textAllowed: true,
        modelRequired: false,
        qualityRules: ["卖点不超过三条", "商品完整露出", "首屏信息密度适中"],
      },
      {
        id: "detail-modules",
        title: "页面模块",
        purpose: "材质、工艺、尺码和场景承接",
        size: "750x1200",
        ratio: "5:8",
        count: 6,
        naming: "detail_module_01-06",
        whiteBackground: false,
        textAllowed: true,
        modelRequired: false,
        qualityRules: ["模块顺序连贯", "局部特写真实", "参数与商品一致"],
      },
    ],
  },
];

export function getExportPackRule(id: ExportPackId): ExportPackRule | undefined {
  return exportPackRules.find((rule) => rule.id === id);
}
