// 产品类别 → 模特交互方式映射
// 多模态模型识别出产品类别后，用这个表决定模特怎么出现在画面里

export const INTERACTION_MAP: Record<string, string> = {
  // 电子数码
  "消费电子": "holding the product naturally, demonstrating usage, clean product-focused shot",
  "数码产品": "holding the product naturally, demonstrating usage, clean product-focused shot",
  "手机": "holding the phone naturally, one-hand use, lifestyle tech scene",
  "电脑": "using the laptop, hands on keyboard, modern workspace setting",
  "平板": "holding the tablet naturally, reading or interacting, cozy setting",
  "耳机": "wearing the headphones/earbuds, enjoying music, lifestyle portrait",
  "音箱": "placing hand near the speaker, enjoying audio, room setting",
  "智能设备": "holding the smart device, modern tech lifestyle",
  "相机": "holding the camera, photographer stance, creative setting",

  // 服装
  "服装": "wearing the garment naturally, fashion model pose, lifestyle setting",
  "上衣": "wearing the top, relaxed fashion pose, casual setting",
  "裤装": "wearing the pants, standing pose, full-body fashion shot",
  "外套": "wearing the jacket, outdoor or urban setting, fashion editorial",
  "连衣裙": "wearing the dress, elegant pose, beautiful setting",
  "运动服": "wearing the activewear, dynamic sporty pose, active setting",
  "T恤": "wearing the t-shirt, casual relaxed pose, everyday setting",

  // 配饰
  "配饰": "wearing the accessory prominently, close-up detail, fashion context",
  "手表": "wearing the watch on wrist, close-up arm pose, elegant context",
  "眼镜": "wearing the glasses, face portrait, sophisticated look",
  "首饰": "wearing the jewelry, elegant close-up, refined setting",
  "帽子": "wearing the hat, casual stylish pose, outdoor or urban",
  "包袋": "carrying the bag naturally, lifestyle setting, fashion context",
  "背包": "wearing the backpack, casual outdoor setting, travel vibe",

  // 鞋履
  "鞋履": "wearing the shoes, foot-focused fashion shot, stylish setting",
  "运动鞋": "wearing the sneakers, athletic pose, dynamic setting",
  "皮鞋": "wearing the shoes, refined standing pose, elegant setting",

  // 美妆
  "美妆": "showing product application on face, beauty portrait, clean beauty shot",
  "护肤": "applying product on hand/face, clean skincare shot",
  "化妆品": "applying makeup, beauty portrait, glamorous setting",
  "口红": "applying lipstick, beauty close-up, elegant portrait",
  "香水": "holding perfume bottle near face/body, elegant fragrance shot",

  // 家居
  "家居": "using the product in lifestyle home setting, natural relaxed scene",
  "家具": "sitting/relaxing on the furniture, cozy home atmosphere",
  "灯具": "standing near the lamp, warm lighting atmosphere, home setting",
  "家纺": "relaxing with the textile, cozy bedroom/living room setting",

  // 食品饮料
  "食品": "holding and enjoying the food naturally, lifestyle eating scene",
  "饮料": "holding the drink naturally, casual lifestyle moment",
  "零食": "eating the snack casually, relaxed everyday scene",
  "健康食品": "enjoying the healthy food, active wellness lifestyle",

  // 运动户外
  "运动器材": "using the equipment actively, athletic workout scene",
  "户外装备": "using the gear in outdoor adventure setting, nature background",
};

// 默认交互描述（当产品类别不在映射表中时使用）
export const DEFAULT_INTERACTION =
  "naturally interacting with the product in a lifestyle setting, authentic moment";

export function getInteraction(category: string): string {
  return INTERACTION_MAP[category] || DEFAULT_INTERACTION;
}
