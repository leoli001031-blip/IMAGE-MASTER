"use client";

import { create } from "zustand";
import type { AIModel, CreateModelParams } from "@/lib/types";

interface ModelState {
  models: AIModel[];
  isLoading: boolean;
  loaded: boolean;
  error: string | null;

  loadModels: () => Promise<void>;
  createModel: (params: CreateModelParams) => Promise<AIModel>;
  deleteModel: (id: string) => Promise<void>;
  regenerateModel: (id: string) => Promise<void>;
  clearError: () => void;
}

export const useModelStore = create<ModelState>((set, get) => ({
  models: [],
  isLoading: false,
  loaded: false,
  error: null,

  clearError: () => set({ error: null }),

  loadModels: async () => {
    if (get().loaded) return;
    set({ isLoading: true });
    try {
      const res = await fetch("/api/models");
      if (!res.ok) throw new Error("Failed to load models");
      const models = await res.json();
      set({ models, loaded: true, error: null });
    } catch (e) {
      console.error("Failed to load models:", e);
      set({ error: "加载失败" });
    } finally {
      set({ isLoading: false });
    }
  },

  createModel: async (params) => {
    set({ error: null });
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create model");
      }
      const model = await res.json();
      set((s) => ({ models: [...s.models, model] }));
      return model;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "创建失败";
      set({ error: msg });
      throw e;
    }
  },

  deleteModel: async (id) => {
    set({ error: null });
    try {
      const res = await fetch(`/api/models/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete model");
      }
      set((s) => ({ models: s.models.filter((m) => m.id !== id) }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "删除失败";
      set({ error: msg });
      throw e;
    }
  },

  regenerateModel: async (id) => {
    set({ error: null });
    try {
      const res = await fetch(`/api/models/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to regenerate model");
      }
      const updated = await res.json();
      set((s) => ({
        models: s.models.map((m) => (m.id === id ? updated : m)),
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "审核失败";
      set({ error: msg });
      throw e;
    }
  },
}));
