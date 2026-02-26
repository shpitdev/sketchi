"use client";

import { useEffect, useRef, useState } from "react";
import { OutputType, Svg2Roughjs } from "svg2roughjs";

import {
  inlineSvgPaintStyles,
  makeRenderedSvgScalable,
} from "@/lib/icon-library/rough-svg";
import type { StyleSettings } from "@/lib/icon-library/svg-to-excalidraw";

interface SketchyIconPreviewProps {
  name: string;
  styleSettings: StyleSettings;
  svgUrl: string | null;
}

const SVG_EXTENSION_REGEX = /\.svg$/i;
const SEPARATOR_REGEX = /[-_]/g;

const formatLabelText = (filename: string) =>
  filename
    .replace(SVG_EXTENSION_REGEX, "")
    .replace(SEPARATOR_REGEX, " ")
    .trim();

const FIXED_SEED = 12_345;
const DEBOUNCE_MS = 300;

export default function SketchyIconPreview({
  name,
  styleSettings,
  svgUrl,
}: SketchyIconPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const converterRef = useRef<Svg2Roughjs | null>(null);

  const [svgText, setSvgText] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debouncedSettings, setDebouncedSettings] =
    useState<StyleSettings>(styleSettings);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSettings(styleSettings);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [styleSettings]);

  useEffect(() => {
    if (containerRef.current && !converterRef.current) {
      converterRef.current = new Svg2Roughjs(
        containerRef.current,
        OutputType.SVG
      );
      converterRef.current.seed = FIXED_SEED;
    }
  }, []);

  useEffect(() => {
    if (!svgUrl) {
      setSvgText(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetch(svgUrl)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to fetch SVG: ${res.status}`);
        }
        return res.text();
      })
      .then((text) => {
        if (!cancelled) {
          setSvgText(text);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to fetch SVG");
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [svgUrl]);

  useEffect(() => {
    if (!(svgText && converterRef.current && containerRef.current)) {
      return;
    }

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgText, "image/svg+xml");

      const parseError = doc.querySelector("parsererror");
      if (parseError) {
        setError("Failed to parse SVG");
        return;
      }

      const svg = doc.querySelector("svg");
      if (!svg) {
        setError("No SVG element found");
        return;
      }

      inlineSvgPaintStyles(svg);

      while (containerRef.current.firstChild) {
        containerRef.current.removeChild(containerRef.current.firstChild);
      }

      converterRef.current.svg = svg;
      converterRef.current.roughConfig = {
        fill: undefined,
        fillStyle: debouncedSettings.fillStyle,
        roughness: debouncedSettings.roughness,
        bowing: debouncedSettings.bowing,
        stroke: "#000000",
        strokeWidth: 2,
      };
      converterRef.current.randomize = debouncedSettings.randomize;
      converterRef.current.pencilFilter = debouncedSettings.pencilFilter;

      converterRef.current.sketch();
      makeRenderedSvgScalable(containerRef.current);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to render sketch");
    }
  }, [svgText, debouncedSettings]);

  if (!svgUrl) {
    return (
      <div className="relative flex aspect-square items-center justify-center rounded border bg-muted/30">
        <span className="text-[10px] text-muted-foreground">preview</span>
      </div>
    );
  }

  const showLabel = debouncedSettings.showLabel;
  const labelText = formatLabelText(name);

  return (
    <div className="relative flex flex-col rounded border bg-muted/30">
      <div className="relative flex aspect-square items-center justify-center">
        {isLoading && (
          <span className="text-[10px] text-muted-foreground">Loading...</span>
        )}
        {error && (
          <span className="text-[10px] text-destructive" title={error}>
            Error
          </span>
        )}
        <div
          aria-label={`Sketchy preview of ${name}`}
          className="flex h-full w-full items-center justify-center p-2 [&>svg]:h-[70%] [&>svg]:w-[70%]"
          ref={containerRef}
          role="img"
        />
      </div>
      {showLabel && (
        <div
          className="border-t px-2 py-1 text-center font-[family-name:var(--font-caveat)]"
          style={{ fontSize: `${debouncedSettings.labelSize}px` }}
        >
          {labelText}
        </div>
      )}
    </div>
  );
}
