import { create } from "zustand";
import type { ViewId } from "./data";

export type SavedWord = {
  id?: string;
  word: string;
  phonetic?: string;
  meaning: string;
  example?: string;
  sourceSong?: string;
};

type MeloState = {
  view: ViewId;
  isPlaying: boolean;
  isRecording: boolean;
  activeWord: string | null;
  savedWords: SavedWord[];
  vocabularyStatus: "idle" | "loading" | "ready" | "error";
  setView: (view: ViewId) => void;
  togglePlaying: () => void;
  toggleRecording: () => void;
  toggleWord: (word: string) => void;
  loadSavedWords: () => Promise<void>;
  saveWord: (word: SavedWord) => Promise<void>;
};

export const useMeloStore = create<MeloState>((set) => ({
  view: "library",
  isPlaying: true,
  isRecording: false,
  activeWord: null,
  savedWords: [],
  vocabularyStatus: "idle",
  setView: (view) => set({ view, activeWord: null }),
  togglePlaying: () => set((state) => ({ isPlaying: !state.isPlaying })),
  toggleRecording: () => set((state) => ({ isRecording: !state.isRecording })),
  toggleWord: (word) =>
    set((state) => ({ activeWord: state.activeWord === word ? null : word })),
  loadSavedWords: async () => {
    set({ vocabularyStatus: "loading" });

    try {
      const response = await fetch("/api/vocabulary");
      if (!response.ok) {
        throw new Error("Failed to load vocabulary");
      }
      const data = await response.json();
      set({ savedWords: data.words, vocabularyStatus: "ready" });
    } catch {
      set({ vocabularyStatus: "error" });
    }
  },
  saveWord: async (word) => {
    set((state) => ({
      savedWords: state.savedWords.some((item) => item.word === word.word)
        ? state.savedWords
        : [{ ...word, word: word.word.toLowerCase() }, ...state.savedWords],
    }));

    try {
      const response = await fetch("/api/vocabulary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(word),
      });
      if (!response.ok) {
        throw new Error("Failed to save vocabulary");
      }
      const data = await response.json();
      set((state) => ({
        savedWords: [
          data.word,
          ...state.savedWords.filter((item) => item.word !== data.word.word),
        ],
        vocabularyStatus: "ready",
      }));
    } catch {
      set({ vocabularyStatus: "error" });
    }
  },
}));
