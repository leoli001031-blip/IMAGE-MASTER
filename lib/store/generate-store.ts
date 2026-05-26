"use client";

import { create } from "zustand";
import type {
  GenerateOptions,
  GenerateStatus,
  GeneratedImage,
  ProductAnalysis,
  ImagePlan,
} from "@/lib/types";

interface GenerateState {
  // 用户输入
  uploadedFile: File | null;
  uploadedFileUrl: string | null;
  productImageBase64: string | null;
  selectedUseCases: string[];
  selectedStyle: string;
  selectedModelIds: string[];
  productInfo: {
    name: string;
    category: string;
    sellingPoints: string[];
  };

  // 生成过程
  status: GenerateStatus;
  progressText: string;
  productAnalysis: ProductAnalysis | null;
  imagePlan: ImagePlan | null;
  generatedImages: GeneratedImage[];
  errorMessage: string | null;

  // Actions
  setUploadedFile: (file: File | null) => void;
  setProductImageBase64: (b64: string) => void;
  setUseCases: (useCases: string[]) => void;
  setStyle: (style: string) => void;
  setModelIds: (ids: string[]) => void;
  setProductInfo: (info: Partial<GenerateState["productInfo"]>) => void;
  setStatus: (status: GenerateStatus) => void;
  setProgressText: (text: string) => void;
  setProductAnalysis: (analysis: ProductAnalysis) => void;
  setImagePlan: (plan: ImagePlan) => void;
  setGeneratedImages: (images: GeneratedImage[]) => void;
  setError: (msg: string) => void;
  reset: () => void;
}

const initialState = {
  uploadedFile: null,
  uploadedFileUrl: null,
  productImageBase64: null,
  selectedUseCases: ["all"],
  selectedStyle: "minimal",
  selectedModelIds: [],
  productInfo: {
    name: "",
    category: "",
    sellingPoints: [],
  },
  status: "idle" as GenerateStatus,
  progressText: "",
  productAnalysis: null,
  imagePlan: null,
  generatedImages: [],
  errorMessage: null,
};

export const useGenerateStore = create<GenerateState>((set) => ({
  ...initialState,

  setUploadedFile: (file) =>
    set((s) => {
      if (s.uploadedFileUrl) URL.revokeObjectURL(s.uploadedFileUrl);
      return {
        uploadedFile: file,
        uploadedFileUrl: file ? URL.createObjectURL(file) : null,
      };
    }),

  setProductImageBase64: (b64) => set({ productImageBase64: b64 }),

  setUseCases: (useCases) => set({ selectedUseCases: useCases }),

  setStyle: (style) => set({ selectedStyle: style }),

  setModelIds: (ids) => set({ selectedModelIds: ids }),

  setProductInfo: (info) =>
    set((s) => ({ productInfo: { ...s.productInfo, ...info } })),

  setStatus: (status) => set({ status }),

  setProgressText: (text) => set({ progressText: text }),

  setProductAnalysis: (analysis) => set({ productAnalysis: analysis }),

  setImagePlan: (plan) => set({ imagePlan: plan }),

  setGeneratedImages: (images) => set({ generatedImages: images }),

  setError: (msg) => set({ status: "error", errorMessage: msg }),

  reset: () =>
    set((s) => {
      if (s.uploadedFileUrl) URL.revokeObjectURL(s.uploadedFileUrl);
      return { ...initialState, uploadedFileUrl: null };
    }),
}));
