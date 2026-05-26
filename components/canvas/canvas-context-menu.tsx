import {
  Box,
  ClipboardList,
  FileText,
  FolderOpen,
  ImagePlus,
  Layers3,
  Maximize2,
  Play,
  RefreshCcw,
  Save,
  Shirt,
  ShoppingBag,
  Sparkles,
  Trash2,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils/cn";

export type CanvasContextMenuKind = "pane" | "imageNode" | "generationFrame";

export type CanvasContextMenuAction =
  | "create-generation-frame"
  | "create-frame-custom-template"
  | "create-product-asset"
  | "create-model-asset"
  | "create-scene-asset"
  | "create-style-asset"
  | "create-knowledge-asset"
  | "import-image"
  | "paste-as-copy"
  | "set-role-product"
  | "set-role-model"
  | "set-role-style"
  | "set-role-scene"
  | "set-role-copy"
  | "add-to-generation-frame"
  | "open-preview"
  | "save-as-asset"
  | "delete"
  | "change-template"
  | "run-generation-frame"
  | "retry-failed"
  | "export";

export interface CanvasContextMenuContext {
  type: CanvasContextMenuKind;
  x: number;
  y: number;
  flowPosition?: { x: number; y: number };
  nodeId?: string;
  label?: string;
  targetFrameId?: string;
  batchId?: string;
  outputUrls?: string[];
  retryJobIds?: string[];
  canRetryFailed?: boolean;
  canExport?: boolean;
  canSaveAsAsset?: boolean;
}

export interface CanvasContextMenuProps {
  context: CanvasContextMenuContext | null;
  onAction: (
    action: CanvasContextMenuAction,
    context: CanvasContextMenuContext
  ) => void;
  onClose?: () => void;
  className?: string;
}

interface MenuItem {
  action: CanvasContextMenuAction;
  label: string;
  icon: LucideIcon;
  destructive?: boolean;
  disabled?: boolean;
}

const roleItems: MenuItem[] = [
  { action: "set-role-product", label: "设为商品", icon: Box },
  { action: "set-role-model", label: "设为模特", icon: Shirt },
  { action: "set-role-style", label: "设为风格", icon: Sparkles },
  { action: "set-role-scene", label: "设为场景", icon: ImagePlus },
  { action: "set-role-copy", label: "设为文案", icon: FileText },
];

export function CanvasContextMenu({
  context,
  onAction,
  onClose,
  className,
}: CanvasContextMenuProps) {
  if (!context) return null;

  const sections = getMenuSections(context);
  const menuPosition = getMenuPosition(context);

  return (
    <div
      className={cn(
        "fixed z-50 min-w-[188px] overflow-x-hidden overflow-y-auto rounded-lg border border-warm-line bg-warm-paper/95 p-1.5 text-sm text-warm-ink shadow-xl backdrop-blur",
        className
      )}
      style={menuPosition}
      role="menu"
      aria-label={getContextLabel(context)}
      onContextMenu={(event) => event.preventDefault()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {context.label && (
        <div className="px-2 py-1.5 text-[11px] font-medium text-warm-muted">
          {context.label}
        </div>
      )}
      {sections.map((section, sectionIndex) => (
        <div
          key={`${context.type}-${sectionIndex}`}
          className={cn(sectionIndex > 0 && "mt-1 border-t border-warm-line/70 pt-1")}
        >
          {section.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.action}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition",
                  item.destructive
                    ? "text-red-700 hover:bg-red-50 disabled:text-red-300"
                    : "text-warm-ink hover:bg-warm-soft disabled:text-warm-muted/45",
                  item.disabled && "cursor-not-allowed"
                )}
                onClick={() => {
                  if (item.disabled) return;
                  onAction(item.action, context);
                  onClose?.();
                }}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function getMenuPosition(context: CanvasContextMenuContext): CSSProperties {
  if (typeof window === "undefined") {
    return { left: context.x, top: context.y };
  }

  const estimatedWidth = 208;
  const estimatedHeight = context.type === "pane" ? 164 : context.type === "generationFrame" ? 212 : 286;
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - estimatedWidth - margin);
  const maxTop = Math.max(margin, window.innerHeight - estimatedHeight - margin);

  return {
    left: Math.min(Math.max(context.x, margin), maxLeft),
    top: Math.min(Math.max(context.y, margin), maxTop),
    maxHeight: `calc(100vh - ${margin * 2}px)`,
  };
}

function getMenuSections(context: CanvasContextMenuContext): MenuItem[][] {
  if (context.type === "pane") {
    return [
      [
        { action: "import-image", label: "导入图片", icon: ImagePlus },
        { action: "paste-as-copy", label: "粘贴文案", icon: ClipboardList },
      ],
      [
        { action: "create-generation-frame", label: "生成框", icon: Wand2 },
        { action: "create-product-asset", label: "商品框", icon: ShoppingBag },
        { action: "create-model-asset", label: "模特框", icon: Shirt },
        { action: "create-scene-asset", label: "场景框", icon: ImagePlus },
        { action: "create-style-asset", label: "风格框", icon: Sparkles },
        { action: "create-knowledge-asset", label: "文案卡", icon: Layers3 },
      ],
      [
        { action: "create-frame-custom-template", label: "自定义模板", icon: Wand2 },
      ],
    ];
  }

  if (context.type === "generationFrame") {
    return [
      [
        { action: "change-template", label: "更换模板", icon: Wand2 },
        { action: "run-generation-frame", label: "生成图组", icon: Play },
        {
          action: "retry-failed",
          label: "重做失败",
          icon: RefreshCcw,
          disabled: context.canRetryFailed === false,
        },
        {
          action: "export",
          label: "打开文件夹",
          icon: FolderOpen,
          disabled: context.canExport === false,
        },
      ],
      [{ action: "delete", label: "删除", icon: Trash2, destructive: true }],
    ];
  }

  return [
    roleItems,
    [
      { action: "open-preview", label: "放大", icon: Maximize2 },
      {
        action: "save-as-asset",
        label: "保存到素材库",
        icon: Save,
        disabled: context.canSaveAsAsset === false,
      },
      { action: "add-to-generation-frame", label: "放入生成框", icon: Wand2 },
    ],
    [{ action: "delete", label: "删除", icon: Trash2, destructive: true }],
  ];
}

function getContextLabel(context: CanvasContextMenuContext): string {
  if (context.type === "pane") return "画布菜单";
  if (context.type === "generationFrame") return "生成框菜单";
  return "图片节点菜单";
}
