import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { createHash } from "node:crypto";
import type { CampaignBible } from "@/lib/canvas/campaign-planning";
import type { GenerationPlanItem, SopExecutionPlan } from "@/lib/canvas/generation-plan";
import {
  type GenerationReferenceContext,
  type GenerationReferenceImage,
  type GenerationReferenceRole,
  type ProviderReferenceAdapter,
  buildProviderReferenceAdapter,
  generationReferenceRoles,
} from "@/lib/canvas/generation-reference-context";
import { getConfig } from "@/lib/store/config-store";

export interface ProviderImagePromptWriterInput {
  item: GenerationPlanItem;
  itemReferenceContext?: GenerationReferenceContext;
  providerReferenceAdapter?: ProviderReferenceAdapter;
  userRequest?: string;
  campaignBible?: CampaignBible;
  sopExecutionPlan?: SopExecutionPlan;
  /** Plan ID used for caching prompts within the same batch. */
  planId?: string;
}

export interface ProviderImagePromptWriterResult {
  prompt: string;
  metadata: {
    version: 1;
    mode: "ai_prompt_writer_v1" | "rule_compiled_v1";
    fallbackUsed: boolean;
    fallbackReason?: string;
    cacheHit?: boolean;
    durationMs?: number;
    timeoutMs?: number;
    sourcePromptChars: number;
    promptChars: number;
    promptLanguage: "zh";
    promptMaxChars: number;
    referenceRoles: GenerationReferenceRole[];
    providerReferenceRoles: GenerationReferenceRole[];
    providerReferenceCount: number;
    promptOnlyReferenceCount: number;
    sourcePromptPreview: string;
  };
}

const providerPromptMaxChars = 1200;
const defaultDeepSeekPromptWriterMaxTokens = 4096;
const defaultPromptWriterTimeoutMs = 45000;

/**
 * In-memory cache so the same plan item doesn't re-burn a text LLM call within
 * one plan execution. Cleared on process restart. The key is item-aware so
 * different shots in the same role combo do not reuse the same final prompt.
 */
const planPromptCache = new Map<string, string>();

export async function writeProviderImagePrompt(
  input: ProviderImagePromptWriterInput
): Promise<ProviderImagePromptWriterResult> {
  const startedAt = Date.now();
  const compiled = buildRuleCompiledPrompt(input);

  if (!shouldUseAiWriter(input)) {
    return buildResult(input, compiled, "rule_compiled_v1", false, undefined, {
      durationMs: elapsedMs(startedAt),
    });
  }

  // Check plan-level cache for identical shot combos
  const cacheKey = input.planId
    ? buildPlanCacheKey(input)
    : undefined;
  if (cacheKey) {
    const cached = planPromptCache.get(cacheKey);
    if (cached) {
      return buildResult(input, cached, "ai_prompt_writer_v1", false, undefined, {
        cacheHit: true,
        durationMs: elapsedMs(startedAt),
      });
    }
  }

  const timeoutMs = getPromptWriterTimeoutMs();
  try {
    const aiPrompt = await rewritePromptWithTextModel(input, compiled, timeoutMs);
    const normalized = normalizeProviderPrompt(aiPrompt, providerPromptMaxChars);
    if (!normalized) {
      return buildResult(input, compiled, "rule_compiled_v1", true, "AI writer returned empty prompt", {
        durationMs: elapsedMs(startedAt),
        timeoutMs,
      });
    }
    if (cacheKey) planPromptCache.set(cacheKey, normalized);
    return buildResult(input, normalized, "ai_prompt_writer_v1", false, undefined, {
      cacheHit: false,
      durationMs: elapsedMs(startedAt),
      timeoutMs,
    });
  } catch (error) {
    return buildResult(
      input,
      compiled,
      "rule_compiled_v1",
      true,
      error instanceof Error ? error.message : "AI prompt writer failed",
      {
        durationMs: elapsedMs(startedAt),
        timeoutMs,
      }
    );
  }
}

/**
 * Route between AI-written and fallback rule-compiled prompts.
 *
 * Real generation is LLM-first: the agent should decide how to use the current
 * shot, selected skills/SOP, and reference roles even for simple-looking tasks.
 * The rule compiler is only a guardrail fallback for tests, explicit opt-out,
 * or text-model failure.
 */
function shouldUseAiWriter(_input: ProviderImagePromptWriterInput): boolean {
  // Hard override — user explicitly disabled the AI writer
  if (process.env.IMAGE_MASTER_DISABLE_AI_PROMPT_WRITER === "1") return false;

  // Mock / smoke mode — no real text LLM calls
  if (
    process.env.IMAGE_MASTER_ENABLE_MOCK_BATCH === "1" ||
    process.env.IMAGE_MASTER_ENABLE_MOCK_JOB_RUNNER === "1"
  ) {
    return false;
  }

  return true;
}

/** Build a cache key from plan ID, shot text, and reference-role fingerprint. */
function buildPlanCacheKey(input: ProviderImagePromptWriterInput): string {
  const adapter =
    input.providerReferenceAdapter ??
    buildProviderReferenceAdapter(input.itemReferenceContext);
  const roles = adapter.providerUsableImages
    .map((image) => image.role)
    .sort()
    .join("+");
  return [
    input.planId,
    input.item.itemId,
    input.item.type,
    hashPromptCacheText(
      [
        input.item.title,
        input.item.prompt,
        input.item.copyText,
        input.item.ratio,
        input.item.size,
      ]
        .filter(Boolean)
        .join("\n")
    ),
    input.item.productReferenceFocus ?? "",
    roles || "text-only",
  ]
    .filter(Boolean)
    .join("::");
}

function hashPromptCacheText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function buildRuleCompiledPrompt(input: ProviderImagePromptWriterInput): string {
  const { item } = input;
  const adapter = input.providerReferenceAdapter ?? buildProviderReferenceAdapter(input.itemReferenceContext);
  const roleLines = buildReferenceRoleLines(adapter, input.itemReferenceContext);
  const sourcePrompt = compactSourcePrompt(item.prompt);
  const productFocus = getShortText(item.productReferenceFocusInstruction, 180);
  const copyPolicy = buildCopyPolicyLine(item);
  const actionLine = buildPoseDirectionLine(item, input.itemReferenceContext);
  const bibleLine = buildCampaignBibleLine(input.campaignBible);

  const lines = [
    `生成一张真实照片：${item.title}。${item.ratio ? `画幅 ${item.ratio}。` : ""}`,
    ...roleLines,
    productFocus ? `商品重点：${productFocus.replace(/^商品参考重点：/, "")}` : "",
    copyPolicy,
    bibleLine,
    sourcePrompt ? `当前镜头：${sourcePrompt}` : "",
    actionLine,
    "如果这是同一批图组中的模特镜头，动作、眼神和手部互动不要与其它镜头重复；每张至少在姿态状态、视线落点、手部动作中变化两项。",
    "动作处方必须具体写出头部方向、唯一眼神落点、肩颈状态、手部动作、身体重心和商品接触关系；每一项只给一个确定选择，不要写多个备选。",
    "表情和眼神服务当前镜头，不复制模卡里的固定表情、直视眼神、站姿或棚拍气质。",
    "避免：拼图、模卡排版、棚拍脸部补光、塑料皮肤、抠图边缘、商品变形、错误五金、漂浮阴影、水印。"
  ].filter(Boolean);

  return normalizeProviderPrompt(lines.join("\n"), providerPromptMaxChars);
}

async function rewritePromptWithTextModel(
  input: ProviderImagePromptWriterInput,
  compiledPrompt: string,
  timeoutMs: number
): Promise<string> {
  const config = getConfig();
  const apiKey = config.textApiKey || config.apiKey;
  const baseURL = config.textBaseUrl || config.baseUrl || "https://slb.apikey.fun/v1";
  if (!apiKey) throw new Error("Text API key not configured");

  const provider = createOpenAI({ apiKey, baseURL });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const adapter = input.providerReferenceAdapter ?? buildProviderReferenceAdapter(input.itemReferenceContext);
  const requestPayload = {
    userRequest: getShortText(input.userRequest, 500),
    shot: {
      title: input.item.title,
      type: input.item.type,
      ratio: input.item.ratio,
      size: input.item.size,
      copyText: getShortText(input.item.copyText, 300),
      textAllowed: input.item.textAllowed === true,
      copyRenderPolicy: input.item.copyRenderPolicy
        ? {
            mode: input.item.copyRenderPolicy.mode,
            allowBurnIn: input.item.copyRenderPolicy.allowBurnIn,
            inImageText: input.item.copyRenderPolicy.inImageText.slice(0, 4),
            sellingPoints: input.item.copyRenderPolicy.sellingPoints.slice(0, 8),
            exportCopy: input.item.copyRenderPolicy.exportCopy.slice(0, 6),
            forbiddenClaims: input.item.copyRenderPolicy.forbiddenClaims.slice(0, 6),
            constraints: input.item.copyRenderPolicy.constraints.slice(0, 6),
            negativeRules: input.item.copyRenderPolicy.negativeRules.slice(0, 6),
          }
        : undefined,
      productReferenceFocus: getShortText(input.item.productReferenceFocus, 240),
      sourcePrompt: getShortText(compactSourcePrompt(input.item.prompt), 1200),
    },
    references: {
      providerInputs: adapter.providerUsableImages.map(referenceSummary),
      promptOnly: adapter.promptOnlyImages.map(referenceSummary),
    },
    assetInvocationPlan: summarizeAssetInvocationPlan(input.item.metadata.assetInvocationPlan),
    sop: {
      keys: input.sopExecutionPlan?.debugSource?.sopKeys?.slice(0, 8) ?? [],
      promptBlocks: input.sopExecutionPlan?.promptBlocks?.slice(0, 5).map((block) => ({
        id: block.id,
        title: block.title,
        content: block.content.map((line) => getShortText(line, 180)).slice(0, 4),
      })),
      qaRules: input.sopExecutionPlan?.qaRules?.slice(0, 8).map((line) => getShortText(line, 160)),
    },
    compiledPrompt: getShortText(compiledPrompt, 1200),
  };

  try {
    const result = await generateText({
      model: provider(config.textModel || "gpt-4o"),
      system: [
        "你是商业摄影图像提示词写作 Agent。",
        "你的任务是把用户需求、SOP、参考图角色和当前镜头，重写成一段真正发给图像模型的短提示词。",
        "不要把 SOP、metadata、参考图说明整段堆进去；只保留对成图有用的规则。",
        "中文为主，简洁、具体。把模特镜头写成动作处方：头往哪偏、眼睛看哪里、肩颈怎么放、手怎么碰商品、重心压在哪只脚、姿态是什么状态。",
        "每个动作字段只给一个确定选择，不能写 A 或 B，不能写多个眼神落点。",
        "如果用户要一组图，必须避免重复动作：同组里的模特镜头不能连续使用同一种低头看扣具/看拉链/手扶商品姿态；当前镜头至少换掉姿态、视线、手部互动中的两项。",
        "禁止只写抽象词，比如自然抓拍、摄影师现场引导、氛围感；这些必须落成可执行的姿势、眼神和手部指令。",
        "必须区分参考图角色：商品锁商品，模特只锁身份，场景锁空间光影，风格只锁完成度。",
        "必须遵守 copyRenderPolicy：mode=burn_in 时，只能把 inImageText 里的短句作为画面可读文字逐字写入 prompt；mode=layout_layer 或 metadata_only 时，禁止让图像模型渲染任何可读标题、卖点、参数、标签或营销文字，只能写预留留白/安全区。",
        "除非用户明确要求包装设计、标签设计、屏幕界面设计或道具字牌，burn_in 文案只能作为画面版式层放在留白、安全区或海报文字区，不得印在商品本体、包装标签、logo、产品屏幕、显示器壁纸、黑板、招牌、贴纸、卡片、便签、菜单、纸张或其它场景道具上。",
        "如果 payload 里有 assetInvocationPlan，必须按它决定的 providerInputs 与 promptOnly 素材写提示词。",
        "输出严格 JSON：{\"prompt\":\"...\"}。prompt 不超过 900 个中文字符。"
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: JSON.stringify(requestPayload),
        },
      ],
      temperature: 0.35,
      maxTokens: getPromptWriterMaxTokens(config.textModel),
      abortSignal: controller.signal,
    });

    const parsed = parsePromptJson(result.text || "");
    if (!parsed) throw new Error("AI prompt writer returned invalid JSON");
    return parsed;
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`AI prompt writer timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function getPromptWriterMaxTokens(modelName: string | undefined): number {
  if (!/deepseek-v4-pro/i.test(modelName || "")) return 900;
  const configured = Number(process.env.IMAGE_MASTER_DEEPSEEK_PROMPT_WRITER_MAX_TOKENS);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : defaultDeepSeekPromptWriterMaxTokens;
}

function getPromptWriterTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.IMAGE_MASTER_PROMPT_WRITER_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 3000
    ? Math.floor(configured)
    : defaultPromptWriterTimeoutMs;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError" ||
    error instanceof Error && /abort|aborted/i.test(error.message);
}

function buildResult(
  input: ProviderImagePromptWriterInput,
  prompt: string,
  mode: ProviderImagePromptWriterResult["metadata"]["mode"],
  fallbackUsed: boolean,
  fallbackReason?: string,
  telemetry?: Pick<
    ProviderImagePromptWriterResult["metadata"],
    "cacheHit" | "durationMs" | "timeoutMs"
  >
): ProviderImagePromptWriterResult {
  const adapter = input.providerReferenceAdapter ?? buildProviderReferenceAdapter(input.itemReferenceContext);
  const referenceRoles = Array.from(
    new Set([
      ...(input.item.referenceRoles ?? []),
      ...adapter.providerUsableImages.map((image) => image.role),
      ...adapter.promptOnlyImages.map((image) => image.role),
    ])
  );
  const providerReferenceRoles = Array.from(
    new Set(adapter.providerUsableImages.map((image) => image.role))
  );
  const policyAlignedPrompt = applyCopyRenderPolicyGuard(prompt, input.item);
  const finalPrompt = normalizeProviderPrompt(policyAlignedPrompt, providerPromptMaxChars);

  return {
    prompt: finalPrompt,
    metadata: {
      version: 1,
      mode,
      fallbackUsed,
      fallbackReason,
      cacheHit: telemetry?.cacheHit,
      durationMs: telemetry?.durationMs,
      timeoutMs: telemetry?.timeoutMs,
      sourcePromptChars: input.item.prompt.length,
      promptChars: finalPrompt.length,
      promptLanguage: "zh",
      promptMaxChars: providerPromptMaxChars,
      referenceRoles,
      providerReferenceRoles,
      providerReferenceCount: adapter.providerUsableImages.length,
      promptOnlyReferenceCount: adapter.promptOnlyImages.length,
      sourcePromptPreview: getShortText(input.item.prompt, 320),
    },
  };
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function applyCopyRenderPolicyGuard(prompt: string, item: GenerationPlanItem): string {
  const policy = item.copyRenderPolicy;
  if (policy?.mode !== "burn_in") return prompt;
  const visibleText = policy.inImageText.map((line) => line.trim()).filter(Boolean).slice(0, 4);
  if (visibleText.length === 0) return prompt;

  let nextPrompt = stripUnsafeBurnInPlacementRules(stripContradictoryNoTextRules(prompt));
  const missing = visibleText.filter((line) => !nextPrompt.includes(line));
  const needsPlacementGuard = !/(留白|安全区|文字区|版式层|海报文字区|干净区域|空白区域)/.test(nextPrompt);

  const textList = visibleText.map((line) => `「${line}」`).join("、");
  const guard = `画面文字：仅把批准短句${textList}作为可读文字放在留白或安全区，逐字准确，不遮挡商品、人物、手部、logo、包装标签、产品屏幕或道具；除这些短句外不要出现任何其它可读文字。`;
  if (missing.length > 0 || needsPlacementGuard || !nextPrompt.includes("仅把批准短句")) {
    const reservedChars = guard.length + 2;
    const base = nextPrompt.length + reservedChars > providerPromptMaxChars
      ? trimToSentenceBoundary(nextPrompt, Math.max(240, providerPromptMaxChars - reservedChars))
      : nextPrompt;
    return `${base.replace(/\s+$/g, "")} ${guard}`;
  }
  return nextPrompt;
}

function stripContradictoryNoTextRules(prompt: string): string {
  return prompt
    .replace(/(?:无|没有|不要|不得|不能|禁止|避免|不出现|不渲染|不显示|不生成|不加入|不添加|不写入|不烧入|不烧进).{0,14}(?:文案|文字|标题|卖点|参数|标签|标语|slogan|copy|版式元素)[，。；、 ]*/gi, "")
    .replace(/(?:文案|文字|标题|卖点|参数|标签|标语|slogan|copy|版式元素).{0,14}(?:无|没有|不要|不得|不能|禁止|避免|不出现|不渲染|不显示|不生成|不加入|不添加|不写入|不烧入|不烧进)[，。；、 ]*/gi, "");
}

function stripUnsafeBurnInPlacementRules(prompt: string): string {
  const textTerms = "(?:文案|文字|标题|卖点|短句|标语|slogan|copy|headline)";
  const placeVerbs = "(?:出现在|出現於|印在|写在|寫在|贴在|貼在|放在|放置在|渲染在|烧在|燒在|烧进|燒進|位于|位於|落在|覆盖在|覆蓋在)";
  const strongPlaceVerbs = "(?:出现在|出現於|印在|写在|寫在|贴在|貼在|渲染在|烧在|燒在|烧进|燒進|位于|位於|落在|覆盖在|覆蓋在)";
  const productSurfaces = "(?:商品|产品|產品|商品本体|商品本體|产品本体|產品本體|机身|機身|外壳|外殼|音箱|扬声孔|揚聲孔|网孔|網孔|格栅|格柵|旋钮|旋鈕|按钮|按鈕|脚垫|腳墊|底座|包装|包裝|标签|標籤|label|logo|Logo|LOGO|屏幕|显示器|顯示器|道具|纸张|紙張|卡片|便签|便簽|菜单|菜單|贴纸|貼紙)";
  const unsafeClauses = [
    new RegExp(`${textTerms}.{0,36}${placeVerbs}.{0,24}${productSurfaces}(?:表面|上|区域|區域)?[，。；、 ]*`, "gi"),
    new RegExp(`${strongPlaceVerbs}.{0,12}${productSurfaces}(?:表面|上|区域|區域)?[，。；、 ]*`, "gi"),
    /\b(?:text|headline|copy|slogan).{0,36}(?:on|onto|printed on|written on|placed on).{0,24}(?:product|body|shell|label|logo|screen|packaging|prop)[,.; ]*/gi,
  ];
  return stripUnsafeBurnInPlacementSentences(
    unsafeClauses.reduce((next, pattern) => next.replace(pattern, ""), prompt)
  );
}

function stripUnsafeBurnInPlacementSentences(prompt: string): string {
  return prompt
    .split(/(?<=[。；;])/)
    .filter((segment) => !isUnsafeBurnInPlacementSentence(segment))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function isUnsafeBurnInPlacementSentence(segment: string): boolean {
  if (!/(?:文案|文字|标题|卖点|短句|标语|slogan|copy|headline|版式文字)/i.test(segment)) return false;
  if (!/(?:商品|产品|商品本体|产品本体|机身|外壳|音箱|扬声孔|网孔|格栅|旋钮|按钮|脚垫|底座|包装|标签|label|logo|屏幕|显示器|道具|纸张|卡片|便签|菜单|贴纸|表面)/i.test(segment)) {
    return false;
  }
  const hasSafeArea = /(?:留白|安全区|文字区|版式层|海报文字区|负空间|干净区域|空白区域)/.test(segment);
  const hasSafeNegation = /(?:不|不要|不得|不能|避免).{0,16}(?:接触|遮挡|遮盖|覆盖|压|印在|写在|贴在|落在|放在|出现在|渲染在|烧在|商品|产品|机身|外壳|音箱|包装|标签|屏幕|道具|脚垫|底座)/.test(segment);
  if (hasSafeArea && hasSafeNegation) return false;
  return /(?:表面|本体|外壳|机身|旋钮|按钮|脚垫|底座|包装|标签|屏幕|道具|纸张|卡片|便签|菜单|贴纸|上)/.test(segment);
}

function buildReferenceRoleLines(
  adapter: ProviderReferenceAdapter,
  context: GenerationReferenceContext | undefined
): string[] {
  const lines: string[] = [];
  const providerInputs = adapter.providerUsableImages;
  if (providerInputs.length > 0) {
    lines.push(
      `参考图输入：${providerInputs
        .map((image, index) => `图${index + 1}=${roleName(image.role)}「${image.title}」`)
        .join("；")}。`
    );
  }

  if (hasRole("product", adapter, context)) {
    lines.push("商品参考只用于锁定商品身份、形状、材质、颜色、五金、肩带/手柄、比例和真实尺度。");
  }
  if (hasRole("model", adapter, context)) {
    lines.push("模特参考只用于锁定同一人的脸型、五官比例、发型轮廓、身形和气质；如果参考图是模卡，使用下游身份参考区的身份信息，不复制展示模卡的原图表情、姿势、棚拍光或排版。");
  }
  if (hasRole("scene", adapter, context)) {
    lines.push("场景参考负责空间、透视、光源方向、阴影、环境色和人物/商品的落位关系。");
  }
  if (hasRole("style", adapter, context)) {
    lines.push("风格参考只用于色调、镜头感、真实质感和商业完成度，不改变商品和人物。");
  }
  if (hasRole("copy", adapter, context)) {
    lines.push("文案参考负责结构化卖点、画面短句、导出文案和禁止声明；是否渲染进图必须服从当前 copyRenderPolicy。");
  }

  return lines;
}

function buildPoseDirectionLine(
  item: GenerationPlanItem,
  context: GenerationReferenceContext | undefined
): string {
  const text = `${item.title} ${item.prompt}`.toLowerCase();
  const hasModel = item.referenceRoles?.includes("model") || Boolean(context?.roles.model);
  const hasProduct = item.referenceRoles?.includes("product") || Boolean(context?.roles.product);
  if (hasModel && hasProduct) {
    if (/detail|close|macro|材质|细节|特写/.test(text)) {
      return pickPoseDirection(item, [
        "动作处方：头微低，眼睛看正在触碰扣具的手指；一只手稳定商品，另一只手轻触商品扣具；肩放松，不直视镜头。",
        "动作处方：上身向商品轻微靠近，眼睛看商品边缘材质；一只手从下方托住商品，另一只手用指腹轻压材质表面；肩线放松，手部不要挡住关键结构。",
        "动作处方：身体侧向镜头 30 度，头略向商品一侧倾斜，眼睛看商品缝线或连接件；一只手拉开衣摆/肩带露出细节，另一只手固定商品位置。",
      ]);
    }
    if (/walk|street|outdoor|carry|行走|街拍|室外|背着|携带/.test(text)) {
      return pickPoseDirection(item, [
        "动作处方：身体以 25 度角穿过画面，重心压在前脚，后脚刚离地；一只手扶住商品握持点，另一只手自然摆动；头轻微转向光源，眼睛看画面右侧的街边橱窗。",
        "动作处方：模特刚停下半步，前脚踩稳、后脚轻点地面；一只手整理肩带或衣领，另一只手自然垂在身体侧边；头转向画面外的街口，眼神不看商品也不看镜头。",
        "动作处方：身体从镜头侧前方经过，重心正在转移到后脚；一只手轻压商品防止晃动，另一只手拨开被风吹乱的发丝；眼睛看远处行人方向。",
      ]);
    }
    if (/sit|seated|cafe|table|坐|咖啡|桌/.test(text)) {
      return pickPoseDirection(item, [
        "动作处方：坐姿上身略向商品倾斜，肩颈放松；一只手轻托下巴，另一只手扶住商品；头向右轻歪，眼睛看商品开口。",
        "动作处方：坐在桌边，身体微微转向窗光；一只手把商品放稳在膝上或桌沿，另一只手整理袖口/肩带；头略低，眼睛看桌面边缘，不看镜头。",
        "动作处方：侧坐在椅子边缘，重心落在靠近镜头的髋部；一只手搭在商品手柄或衣服门襟上，另一只手自然放在杯子旁；眼睛看窗外光源方向。",
      ]);
    }
    return pickPoseDirection(item, [
      "动作处方：身体微侧 20 度，重心压在左脚，肩放松；头向右轻微倾斜，下巴自然；一只手托住商品底部，另一只手放松垂下；眼睛看镜头右侧 30 厘米的位置，不要正死盯镜头。",
      "动作处方：身体正面但上半身轻微转向光源，重心压在右脚；一只手轻搭商品握持点，另一只手整理衣摆或袖口；头略向左偏，眼睛看画面下方的商品边缘。",
      "动作处方：身体 3/4 侧身，肩膀一前一后形成层次，重心在后脚；一只手把商品靠近身体侧面，另一只手自然抬起整理头发；眼睛看画面外上方的橱窗光。",
      "动作处方：模特靠近墙面或桌边自然停住，重心落在靠支撑物的一侧；一只手扶住商品，另一只手轻触墙面/桌沿保持平衡；头微低但眼睛看远处，不看手。",
    ]);
  }
  if (hasProduct) {
    return "摆放处方：商品必须有明确承托面、接触阴影、材质高光和可读结构，别做成漂浮的电商合成图。";
  }
  return "画面处方：写清楚主体朝向、视线落点、手部动作、光源方向和一个轻微不完美细节，让画面像真实摄影而不是模板图。";
}

function pickPoseDirection(item: GenerationPlanItem, options: string[]): string {
  if (options.length === 0) return "";
  const key = [item.itemId, item.title, item.type, item.prompt, item.ratio].filter(Boolean).join("\n");
  const digest = createHash("sha256").update(key).digest();
  return options[digest[0] % options.length];
}

function buildCopyPolicyLine(item: GenerationPlanItem): string {
  const text = getShortText(item.copyText, 180);
  const policy = item.copyRenderPolicy;
  if (!text && !policy) return "";
  if (policy?.mode === "burn_in") {
    const visibleText = policy.inImageText.map((line) => line.trim()).filter(Boolean).slice(0, 3);
    if (visibleText.length > 0) {
      return `画面文字模式：烧进图片。只渲染这些批准短句：${visibleText.map((line) => `「${line}」`).join("、")}；不要改写，不要增加其他文字；文案只能作为画面版式层放在留白、安全区或海报文字区，不得印在商品本体、包装标签、logo、产品屏幕、显示器壁纸、黑板、招牌、贴纸、卡片、便签、菜单、纸张或其它场景道具上。`;
    }
    return "画面文字模式：烧进图片，但当前没有批准短句；不要自行发明画面文字。";
  }
  if (policy?.mode === "layout_layer") {
    const points = policy.sellingPoints.slice(0, 4).join("；") || text;
    return `文案图层模式：不要在图片里渲染任何可读标题、卖点、参数或营销文字；只根据卖点安排画面证据并预留干净留白。卖点：${points}。`;
  }
  if (policy?.mode === "metadata_only") {
    const points = policy.sellingPoints.slice(0, 4).join("；") || text;
    return points
      ? `文案仅作理解：不要把文字烧进图片，不要预设标题排版；只用这些信息决定画面证明点：${points}。`
      : "文案仅作元数据：图片内不要出现可读营销文字。";
  }
  if (item.textAllowed) {
    return `可使用少量画面文字：${text}。文字要少、准、像真实商业版式。`;
  }
  return `文案只作为卖点理解，不默认烧进图片：${text}。`;
}

function buildCampaignBibleLine(campaignBible: CampaignBible | undefined): string {
  if (!campaignBible) return "";
  const parts = [
    campaignBible.visualStrategy.consistencyRule,
    campaignBible.visualStrategy.variationRule,
    campaignBible.productDescription,
  ].map((item) => getShortText(item, 80)).filter(Boolean);
  return parts.length ? `统一视觉：${parts.join("；")}。` : "";
}

function referenceSummary(image: GenerationReferenceImage, index: number) {
  return {
    index: index + 1,
    role: image.role,
    title: image.title,
    providerMode: image.providerMode,
  };
}

function summarizeAssetInvocationPlan(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return {
    version: record.version,
    mode: record.mode,
    fallbackUsed: record.fallbackUsed,
    fallbackReason: getShortText(record.fallbackReason, 160) || undefined,
    referenceRoles: getStringArray(record.referenceRoles, generationReferenceRoles),
    providerReferenceRoles: getStringArray(record.providerReferenceRoles, generationReferenceRoles),
    unusedRoles: getStringArray(record.unusedRoles, generationReferenceRoles),
    decisions: Array.isArray(record.decisions)
      ? record.decisions.slice(0, 8).map((decision) => summarizeAssetInvocationDecision(decision))
      : [],
    notes: Array.isArray(record.notes)
      ? record.notes.map((note) => getShortText(note, 160)).filter(Boolean).slice(0, 6)
      : [],
  };
}

function summarizeAssetInvocationDecision(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return {
    role: typeof record.role === "string" ? record.role : undefined,
    mode: typeof record.mode === "string" ? record.mode : undefined,
    providerInput: typeof record.providerInput === "boolean" ? record.providerInput : undefined,
    reason: getShortText(record.reason, 160),
  };
}

function getStringArray(value: unknown, allowList?: readonly string[]): string[] {
  if (!Array.isArray(value)) return [];
  const allowSet = allowList ? new Set(allowList) : undefined;
  return value
    .filter((item): item is string => typeof item === "string" && !!item.trim())
    .map((item) => item.trim())
    .filter((item) => !allowSet || allowSet.has(item))
    .slice(0, 12);
}

function hasRole(
  role: GenerationReferenceRole,
  adapter: ProviderReferenceAdapter,
  context: GenerationReferenceContext | undefined
): boolean {
  return Boolean(context?.roles[role]) ||
    adapter.providerUsableImages.some((image) => image.role === role) ||
    adapter.promptOnlyImages.some((image) => image.role === role);
}

function roleName(role: GenerationReferenceRole): string {
  switch (role) {
    case "product":
      return "商品";
    case "model":
      return "模特";
    case "scene":
      return "场景";
    case "style":
      return "风格";
    case "copy":
      return "文案";
  }
}

function compactSourcePrompt(prompt: string): string {
  return prompt
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^Reference context:/i.test(line))
    .filter((line) => !/^Product reference focus:/i.test(line))
    .filter((line) => !/^参考图输入[:：]/i.test(line))
    .filter((line) => !/^已传入参考图[:：]/i.test(line))
    .map((line) => line.replace(/^[-*]\s*/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/商品参考重点：/g, "")
    .trim();
}

function normalizeProviderPrompt(prompt: string, maxChars: number): string {
  const normalized = prompt
    .replace(/```(?:json)?/g, "")
    .replace(/```/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  if (normalized.length <= maxChars) return normalized;
  return trimToSentenceBoundary(normalized, maxChars);
}

function trimToSentenceBoundary(text: string, maxChars: number): string {
  const sliced = text.slice(0, maxChars);
  const boundary = Math.max(
    sliced.lastIndexOf("。"),
    sliced.lastIndexOf("！"),
    sliced.lastIndexOf("？"),
    sliced.lastIndexOf("\n")
  );
  return (boundary > maxChars * 0.6 ? sliced.slice(0, boundary + 1) : sliced).trim();
}

function getShortText(value: unknown, maxChars: number): string {
  if (typeof value !== "string") return "";
  return normalizeProviderPrompt(value, maxChars);
}

function parsePromptJson(text: string): string | undefined {
  const cleaned = text.trim();
  const candidates = [
    cleaned,
    cleaned.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim(),
    cleaned.match(/\{[\s\S]*\}/)?.[0],
  ].filter((item): item is string => !!item);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { prompt?: unknown };
      if (typeof parsed.prompt === "string" && parsed.prompt.trim()) return parsed.prompt.trim();
    } catch {
      // try next candidate
    }
  }

  const promptField = cleaned.match(/["']?prompt["']?\s*[:：]\s*(["'])([\s\S]*?)\1/);
  if (promptField?.[2]?.trim()) {
    return promptField[2]
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, "\"")
      .trim();
  }

  const loosePrompt = cleaned
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .replace(/^\s*\{?\s*["']?prompt["']?\s*[:：]\s*/i, "")
    .replace(/\}\s*$/i, "")
    .trim();
  if (loosePrompt.length >= 24 && !/^\s*\{/.test(loosePrompt)) {
    return loosePrompt.replace(/^["']|["']$/g, "").trim();
  }
  return undefined;
}
