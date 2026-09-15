import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

export function useLineHeights(
  editorRef: RefObject<HTMLTextAreaElement | null>,
  text: string,
  locked: boolean,
  activeTabId?: string,
) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const [lineHeights, setLineHeights] = useState<number[]>([20]);
  const [measureVersion, setMeasureVersion] = useState(0);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const observer = new ResizeObserver(() =>
      setMeasureVersion((value) => value + 1),
    );
    observer.observe(editor);
    void document.fonts?.ready.then(() =>
      setMeasureVersion((value) => value + 1),
    );
    return () => observer.disconnect();
  }, [activeTabId, editorRef]);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor || locked) return;
    const styles = getComputedStyle(editor);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 18;
    const mirror = document.createElement("div");
    Object.assign(mirror.style, {
      position: "fixed",
      left: "-10000px",
      top: "0",
      visibility: "hidden",
      pointerEvents: "none",
      width: `${editor.clientWidth}px`,
      padding: styles.padding,
      border: "0",
      boxSizing: "border-box",
      fontFamily: styles.fontFamily,
      fontSize: styles.fontSize,
      fontWeight: styles.fontWeight,
      fontStyle: styles.fontStyle,
      letterSpacing: styles.letterSpacing,
      lineHeight: styles.lineHeight,
      whiteSpace: "pre-wrap",
      overflowWrap: "break-word",
      wordBreak: styles.wordBreak,
    });
    const spans = text.split("\n").map((line) => {
      const span = document.createElement("span");
      span.style.display = "block";
      span.style.minHeight = `${lineHeight}px`;
      span.textContent = line || "\u200b";
      mirror.append(span);
      return span;
    });
    document.body.append(mirror);
    setLineHeights(
      spans.map((span) =>
        Math.max(lineHeight, span.getBoundingClientRect().height),
      ),
    );
    mirror.remove();
  }, [editorRef, locked, measureVersion, text]);

  return { gutterRef, lineHeights };
}
