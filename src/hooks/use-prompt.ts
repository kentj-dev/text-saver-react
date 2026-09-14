import { useCallback, useRef, useState } from 'react';
import type { PromptConfig } from '@/types';

export type PromptResult = boolean | string | string[] | null;

export function usePrompt() {
  const [promptConfig, setPromptConfig] = useState<PromptConfig | null>(null);
  const resolver = useRef<((value: PromptResult) => void) | undefined>(undefined);

  const ask = useCallback((config: PromptConfig) => new Promise<PromptResult>((resolve) => {
    resolver.current?.(null);
    resolver.current = resolve;
    setPromptConfig(config);
  }), []);

  const resolvePrompt = useCallback((value: PromptResult) => {
    const resolve = resolver.current;
    resolver.current = undefined;
    setPromptConfig(null);
    resolve?.(value);
  }, []);

  return { promptConfig, ask, resolvePrompt };
}
